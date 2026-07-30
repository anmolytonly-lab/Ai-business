/**
 * Single-agent execution. Runs one agent against one instruction using its own
 * systemPrompt, model and temperature. When the agent is granted tools it runs
 * a tool-calling loop: the model requests tools, the registry enforces
 * permissions and the sandbox, results are fed back, and every step is audited.
 */
import crypto from "node:crypto";
import { logEvent } from "../audit";
import { formatContext, search } from "../brain";
import { withHandbook } from "../brain/handbook";
import { generateStep, generateText } from "../llm/provider";
import { GeminiContent, LlmUsage } from "../llm/types";
import { callTool, declarationsForAgent } from "../tools/registry";
import { getAgent } from "./registry";
import { setAgentStatus } from "./status";

/** Safety valve on tool loops — a stuck agent stops rather than spinning. */
const MAX_TOOL_ITERATIONS = 8;

export interface RunContext {
  workspaceId?: string;
  taskId?: string;
}

export interface ToolCallSummary {
  tool: string;
  ok: boolean;
}

export interface AgentRunResult {
  runId: string;
  agentId: string;
  output: string;
  usage: LlmUsage;
  /** True when the run's cost exceeded the agent's maxCostPerTask. */
  overBudget: boolean;
  toolCalls: ToolCallSummary[];
  /** Knowledge-base chunks injected before the agent answered. */
  contextUsed: { title: string; score: number }[];
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    latencyMs: a.latencyMs + b.latencyMs,
    model: b.model,
  };
}

export async function runAgent(
  agentId: string,
  instruction: string,
  ctx: RunContext = {}
): Promise<AgentRunResult> {
  const agent = getAgent(agentId);
  if (agent === undefined) {
    throw new Error(`unknown agent "${agentId}" — not present in /agents`);
  }
  if (instruction.trim() === "") {
    throw new Error("instruction must not be empty");
  }

  const runId = crypto.randomUUID();
  const workspaceId = ctx.workspaceId ?? "default";
  const base = {
    agentId: agent.id,
    workspaceId,
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
  };
  // Every agent retrieves company context before answering, and every agent's
  // prompt is bound by the company handbook.
  let contextUsed: { title: string; score: number }[] = [];
  let contextBlock = "";
  try {
    const hits = await search(workspaceId, instruction);
    contextUsed = hits.map((h) => ({ title: h.title, score: Number(h.score.toFixed(3)) }));
    contextBlock = formatContext(hits);
  } catch (err) {
    // Retrieval failure must not silently become an ungrounded answer.
    console.error(
      `knowledge base retrieval failed for ${agent.id}: ${err instanceof Error ? err.message : String(err)}`
    );
    logEvent({
      agentId: agent.id,
      workspaceId,
      eventType: "brain_retrieval_failed",
      detail: { runId, error: err instanceof Error ? err.message : String(err) },
    });
  }

  const prompt = contextBlock === "" ? instruction : `${contextBlock}\n\n---\n\n${instruction}`;

  const llmOpts = {
    systemPrompt: withHandbook(agent.systemPrompt),
    model: agent.model,
    temperature: agent.temperature,
    agentId: agent.id,
    workspaceId,
    purpose: `agent-run:${runId}`,
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
  };

  const declarations = declarationsForAgent(agent.id);

  setAgentStatus(agent.id, "working", {
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
    detail: instruction,
  });

  logEvent({
    ...base,
    eventType: "agent_run_started",
    detail: {
      runId,
      instruction,
      model: agent.model,
      toolsGranted: declarations.map((d) => d.name),
      contextUsed,
    },
  });

  try {
    let usage: LlmUsage = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      model: agent.model,
    };
    let output: string;
    const toolCalls: ToolCallSummary[] = [];
    let budgetStopped = false;

    if (declarations.length === 0) {
      // No tools granted — a single completion.
      const result = await generateText(prompt, llmOpts);
      output = result.text;
      usage = result.usage;
    } else {
      const contents: GeminiContent[] = [{ role: "user", parts: [{ text: prompt }] }];
      let finalText = "";

      for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
        const step = await generateStep(contents, declarations, llmOpts);
        usage = addUsage(usage, step.usage);
        if (step.text !== "") finalText = step.text;

        if (step.functionCalls.length === 0) break;

        // Enforce the per-task cost cap inside the loop, not just after it.
        if (usage.costUsd > agent.maxCostPerTask) {
          budgetStopped = true;
          logEvent({
            ...base,
            eventType: "agent_tool_loop_budget_stop",
            detail: { runId, iteration, costUsd: usage.costUsd, maxCostPerTask: agent.maxCostPerTask },
          });
          finalText =
            finalText === ""
              ? `Stopped: this task exceeded its cost cap of $${agent.maxCostPerTask} before completing.`
              : finalText;
          break;
        }

        contents.push({
          role: "model",
          parts: step.functionCalls.map((fc) => ({
            functionCall: { name: fc.name, args: fc.args },
          })),
        });

        const responseParts = [];
        for (const fc of step.functionCalls) {
          const { result, ok } = await callTool(fc.name, fc.args, {
            workspaceId,
            agentId: agent.id,
            ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
          });
          toolCalls.push({ tool: fc.name, ok });
          responseParts.push({
            functionResponse: { name: fc.name, response: { result } },
          });
        }
        contents.push({ role: "user", parts: responseParts });

        if (iteration === MAX_TOOL_ITERATIONS) {
          logEvent({
            ...base,
            eventType: "agent_tool_loop_exhausted",
            detail: { runId, iterations: iteration, toolCalls: toolCalls.length },
          });
          if (finalText === "") {
            finalText = `Stopped after ${MAX_TOOL_ITERATIONS} tool iterations without a final answer.`;
          }
        }
      }
      output = finalText;
    }

    const overBudget = usage.costUsd > agent.maxCostPerTask;
    if (overBudget) {
      logEvent({
        ...base,
        eventType: "agent_over_budget",
        detail: { runId, costUsd: usage.costUsd, maxCostPerTask: agent.maxCostPerTask, budgetStopped },
      });
    }

    logEvent({
      ...base,
      eventType: "agent_run_completed",
      detail: {
        runId,
        outputPreview: output.slice(0, 300),
        outputChars: output.length,
        costUsd: usage.costUsd,
        latencyMs: usage.latencyMs,
        toolCalls,
      },
    });

    return { runId, agentId: agent.id, output, usage, overBudget, toolCalls, contextUsed };
  } catch (err) {
    logEvent({
      ...base,
      eventType: "agent_run_failed",
      detail: { runId, error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  } finally {
    setAgentStatus(agent.id, "idle");
  }
}
