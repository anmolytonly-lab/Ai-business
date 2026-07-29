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
