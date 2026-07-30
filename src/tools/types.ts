import { z } from "zod";

export interface ToolCallContext {
  workspaceId: string;
  agentId: string;
  taskId?: string;
}

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  /**
   * JSON Schema (OpenAPI subset) advertised to the model. Kept separate from
   * argsSchema so what the model sees and what we enforce are both explicit.
   */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Runtime validation of the model's arguments. */
  argsSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** True for tools that reach outside the system (Phase 10 integrations). */
  external?: boolean;
  handler: (args: T, ctx: ToolCallContext) => Promise<string> | string;
}

export class ToolPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolPermissionError";
  }
}
