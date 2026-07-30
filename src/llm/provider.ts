/**
 * The ONE LLM provider module. Every agent call goes through here so models
 * can be swapped per-agent later and every call is audited and costed.
 * Talks to the Gemini REST API directly with Node's global fetch — no SDK.
 */
import { z } from "zod";
import { env, requireGeminiKey } from "../config/env";
import { getDb } from "../db";
import { assertWithinBudget } from "../safety/budget";
import { assertNotKilled } from "../safety/killswitch";
import {
  ChatMessage,
  GenerateOptions,
  GeminiContent,
  LlmError,
  LlmResult,
  LlmStepResult,
  LlmUsage,
  ToolDeclaration,
} from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// USD per 1M tokens. Estimates for budget tracking — update as pricing moves.
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};
const DEFAULT_PRICING = { input: 0.3, output: 2.5 };

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { code?: number; message?: string };
}

function logCall(
  opts: GenerateOptions,
  model: string,
  request: string,
  response: string | null,
  usage: LlmUsage,
  error?: string
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO llm_calls
           (workspace_id, agent_id, task_id, model, purpose, system_prompt,
            request, response, input_tokens, output_tokens, cost_usd,
            latency_ms, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.workspaceId ?? null,
        opts.agentId ?? null,
        opts.taskId ?? null,
        model,
        opts.purpose ?? null,
        opts.systemPrompt ?? null,
        request,
        response,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsd,
        usage.latencyMs,
        error === undefined ? "ok" : "error",
        error ?? null
      );
  } catch (err) {
    // Audit logging must never take down the call itself, but is never silent.
    console.error("failed to write llm_calls audit row:", err);
  }
}

/**
 * Core request. Takes Gemini `contents` directly so callers can carry tool
 * calls and tool responses through a multi-step loop.
 */
async function callGemini(
  contents: GeminiContent[],
  opts: GenerateOptions,
  tools?: ToolDeclaration[]
): Promise<LlmStepResult> {
  // Single choke point for safety: nothing reaches the model with the kill
  // switch engaged or a spend cap already met.
  assertNotKilled();
  assertWithinBudget(opts.agentId);

  const apiKey = requireGeminiKey();
  const model = opts.model ?? env.GEMINI_MODEL;
  const url = `${API_BASE}/models/${model}:generateContent`;

  const body = {
    contents,
    ...(opts.systemPrompt !== undefined
      ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } }
      : {}),
    ...(tools !== undefined && tools.length > 0
      ? {
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }
      : {}),
    generationConfig: {
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxOutputTokens !== undefined
        ? { maxOutputTokens: opts.maxOutputTokens }
        : {}),
    },
  };

  const requestJson = JSON.stringify(contents);
  const started = Date.now();
  let lastError: LlmError = new LlmError("Gemini call failed before any attempt");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = new LlmError(
        `network error calling Gemini: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        console.warn(`Gemini network error, retrying in ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await sleep(wait);
        continue;
      }
      break;
    }

    const raw = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (res.status === 429 || res.status >= 500) {
      lastError = new LlmError(
        `Gemini ${res.status}: ${raw.error?.message ?? res.statusText}`,
        res.status,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        console.warn(
          `Gemini ${res.status} (rate limit/server), retrying in ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
        await sleep(wait);
        continue;
      }
      break;
    }

    if (!res.ok) {
      lastError = new LlmError(
        `Gemini ${res.status}: ${raw.error?.message ?? res.statusText}`,
        res.status,
        false
      );
      break;
    }

    const latencyMs = Date.now() - started;
    const parts = raw.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    const functionCalls = parts
      .filter((p) => p.functionCall?.name !== undefined)
      .map((p) => ({
        name: p.functionCall?.name ?? "",
        args: p.functionCall?.args ?? {},
      }));

    const inputTokens = raw.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens =
      (raw.usageMetadata?.candidatesTokenCount ?? 0) +
      (raw.usageMetadata?.thoughtsTokenCount ?? 0);
    const usage: LlmUsage = {
      inputTokens,
      outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
      latencyMs,
      model,
    };

    // A step with no text is fine when the model asked for tools instead.
    if (text === "" && functionCalls.length === 0) {
      const reason = raw.candidates?.[0]?.finishReason ?? "no candidates returned";
      const error = new LlmError(`Gemini returned empty response (${reason})`, res.status, false);
      logCall(opts, model, requestJson, JSON.stringify(raw), usage, error.message);
      throw error;
    }

    const logged =
      functionCalls.length > 0
        ? `${text}\n[tool calls: ${JSON.stringify(functionCalls)}]`
        : text;
    logCall(opts, model, requestJson, logged, usage);
    return { text, functionCalls, usage };
  }

  const latencyMs = Date.now() - started;
  logCall(
    opts,
    model,
    requestJson,
    null,
    { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, model },
    lastError.message
  );
  throw lastError;
}

function toContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
}

/** Plain text generation from a single prompt. */
export async function generateText(
  prompt: string,
  opts: GenerateOptions = {}
): Promise<LlmResult> {
  const step = await callGemini(toContents([{ role: "user", content: prompt }]), opts);
  return { text: step.text, usage: step.usage };
}

/** Multi-turn generation. */
export async function generateChat(
  messages: ChatMessage[],
  opts: GenerateOptions = {}
): Promise<LlmResult> {
  const step = await callGemini(toContents(messages), opts);
  return { text: step.text, usage: step.usage };
}

/**
 * One step of a tool-using conversation: the model either answers with text or
 * requests tool calls. The caller executes the tools and appends the results.
 */
export async function generateStep(
  contents: GeminiContent[],
  tools: ToolDeclaration[],
  opts: GenerateOptions = {}
): Promise<LlmStepResult> {
  return callGemini(contents, opts, tools);
}

interface EmbedResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

/**
 * Embed text for the Company Brain. Same key, same backoff policy as
 * generation, so all model access stays in this one module.
 * `taskType` lets Gemini optimise query vs document embeddings.
 */
export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  assertNotKilled();
  assertWithinBudget();

  const apiKey = requireGeminiKey();
  const model = env.GEMINI_EMBEDDING_MODEL;
  const url = `${API_BASE}/models/${model}:embedContent`;
  const body = {
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: env.EMBEDDING_DIMENSIONS,
  };

  let lastError: LlmError = new LlmError("embedding call failed before any attempt");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = new LlmError(
        `network error calling embeddings: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      break;
    }

    const raw = (await res.json().catch(() => ({}))) as EmbedResponse;
    if (res.status === 429 || res.status >= 500) {
      lastError = new LlmError(
        `embeddings ${res.status}: ${raw.error?.message ?? res.statusText}`,
        res.status,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        console.warn(`embeddings ${res.status}, retrying in ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (!res.ok) {
      throw new LlmError(
        `embeddings ${res.status}: ${raw.error?.message ?? res.statusText}`,
        res.status,
        false
      );
    }

    const values = raw.embedding?.values;
    if (values === undefined || values.length === 0) {
      throw new LlmError("embeddings returned no vector", res.status, false);
    }
    if (values.length !== env.EMBEDDING_DIMENSIONS) {
      throw new LlmError(
        `embedding dimension mismatch: got ${values.length}, schema expects ${env.EMBEDDING_DIMENSIONS}`,
        res.status,
        false
      );
    }
    return values;
  }
  throw lastError;
}

function stripFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fence?.[1] !== undefined) t = fence[1].trim();
  return t;
}

const JSON_ONLY_INSTRUCTION =
  "Respond with ONLY a valid JSON value matching the requested shape. " +
  "No markdown fences, no commentary, no trailing text.";

/**
 * JSON-returning call: instructs JSON-only output, strips markdown fences,
 * validates with zod, and retries once with the parse error on failure.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: GenerateOptions = {}
): Promise<{ data: T; usage: LlmUsage }> {
  const fullPrompt = `${prompt}\n\n${JSON_ONLY_INSTRUCTION}`;
  const first = await generateText(fullPrompt, opts);

  const attemptParse = (text: string): { ok: true; data: T } | { ok: false; error: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch (err) {
      return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) return { ok: false, error: `schema mismatch: ${result.error.message}` };
    return { ok: true, data: result.data };
  };

  const firstTry = attemptParse(first.text);
  if (firstTry.ok) return { data: firstTry.data, usage: first.usage };

  console.warn(`JSON parse failed (${firstTry.error}), retrying once`);
  const retry = await generateText(
    `${fullPrompt}\n\nYour previous response could not be parsed (${firstTry.error}).\n` +
      `Previous response:\n${first.text}\n\nReturn ONLY corrected valid JSON.`,
    { ...opts, purpose: `${opts.purpose ?? "json"}-retry` }
  );

  const secondTry = attemptParse(retry.text);
  if (!secondTry.ok) {
    throw new LlmError(
      `JSON output failed validation after retry: ${secondTry.error}`,
      undefined,
      false
    );
  }
  const usage: LlmUsage = {
    inputTokens: first.usage.inputTokens + retry.usage.inputTokens,
    outputTokens: first.usage.outputTokens + retry.usage.outputTokens,
    costUsd: first.usage.costUsd + retry.usage.costUsd,
    latencyMs: first.usage.latencyMs + retry.usage.latencyMs,
    model: retry.usage.model,
  };
  return { data: secondTry.data, usage };
}
