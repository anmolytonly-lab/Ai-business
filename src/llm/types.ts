export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

/** Context attached to a call so it lands in the audit log / budget tracking. */
export interface CallContext {
  workspaceId?: string;
  agentId?: string;
  taskId?: string;
  /** Short label for the audit log, e.g. "decompose-goal", "draft-caption". */
  purpose?: string;
}

export interface GenerateOptions extends CallContext {
  /** Overrides GEMINI_MODEL for this call (per-agent models come in Phase 2). */
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
}

/** A tool the model is allowed to call, in Gemini functionDeclaration form. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/** Raw Gemini content parts — carries text, tool calls and tool results. */
export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/** One step of a tool-using exchange: text, tool requests, or both. */
export interface LlmStepResult {
  text: string;
  functionCalls: FunctionCall[];
  usage: LlmUsage;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "LlmError";
  }
}
