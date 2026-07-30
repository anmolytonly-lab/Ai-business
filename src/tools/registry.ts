/**
 * Tool registry + the single enforcement point for tool permissions.
 * An agent may only call tools listed in its own `tools[]` — including
 * external integrations (spec item 14). Every call is audited.
 */
import { getAgent } from "../agents/registry";
import { logEvent } from "../audit";
import { isKillSwitchOn } from "../safety/killswitch";
import { SandboxViolation } from "./sandbox";
import { dbQueryTool } from "./impl/db";
import { fileListTool, fileReadTool, fileWriteTool } from "./impl/files";
import { kbSearchTool, kbWriteTool } from "./impl/kb";
import { shellTool } from "./impl/shell";
import { webSearchTool } from "./impl/stubs";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous
// arg types across tools; each definition validates its own args with zod, so
// the unsafe boundary is contained to the callTool() dispatch below.
import { ToolDefinition, ToolCallContext, ToolPermissionError } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tools have different argument shapes; storing them together requires erasing
// the arg type. Each entry validates its own args via argsSchema before use.
const ALL_TOOLS: ToolDefinition<any>[] = [
  fileReadTool,
  fileWriteTool,
  fileListTool,
  shellTool,
  dbQueryTool,
  kbSearchTool,
  kbWriteTool,
  webSearchTool,
];
/* eslint-enable @typescript-eslint/no-explicit-any */

const registry = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): (typeof ALL_TOOLS)[number] | undefined {
  return registry.get(name);
}

export function listTools(): { name: string; description: string; external: boolean }[] {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    external: t.external === true,
  }));
}

/** Tool declarations for the model, filtered to what this agent may use. */
export function declarationsForAgent(agentId: string): {
  name: string;
  description: string;
  parameters: ToolDefinition["parameters"];
}[] {
  const agent = getAgent(agentId);
  if (agent === undefined) return [];
  const declarations = [];
  for (const name of agent.tools) {
    const tool = registry.get(name);
    if (tool === undefined) {
      console.warn(`agent ${agentId} declares unknown tool "${name}" — ignoring`);
      continue;
    }
    declarations.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }
  return declarations;
}

export function agentMayUse(agentId: string, toolName: string): boolean {
  return getAgent(agentId)?.tools.includes(toolName) === true;
}

/**
 * Execute a tool on behalf of an agent. Returns the string result to feed back
 * to the model. Permission failures, sandbox violations and handler errors all
 * come back as messages the model can react to — and all are audited.
 */
export async function callTool(
  toolName: string,
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<{ result: string; ok: boolean }> {
  const audit = {
    workspaceId: ctx.workspaceId,
    agentId: ctx.agentId,
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
  };

  // The kill switch halts tool use too, not just model calls.
  if (isKillSwitchOn()) {
    logEvent({ ...audit, eventType: "tool_call_rejected", detail: { toolName, reason: "kill switch" } });
    return {
      result: "ERROR: kill switch is engaged — all agent activity is halted.",
      ok: false,
    };
  }

  const tool = registry.get(toolName);
  if (tool === undefined) {
    const message = `ERROR: no such tool "${toolName}"`;
    logEvent({ ...audit, eventType: "tool_call_rejected", detail: { toolName, reason: "unknown tool" } });
    return { result: message, ok: false };
  }

  // Permission gate — the agent's own tools[] is the only authority.
  if (!agentMayUse(ctx.agentId, toolName)) {
    const message =
      `ERROR: permission denied — agent "${ctx.agentId}" is not granted the "${toolName}" tool. ` +
      `Do not attempt it again; complete the task without it or report that you cannot.`;
    logEvent({
      ...audit,
      eventType: "tool_permission_denied",
      detail: { toolName, grantedTools: getAgent(ctx.agentId)?.tools ?? [] },
    });
    console.warn(`tool permission denied: ${ctx.agentId} -> ${toolName}`);
    return { result: message, ok: false };
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const message = `ERROR: invalid arguments for "${toolName}": ${parsed.error.message}`;
    logEvent({ ...audit, eventType: "tool_call_rejected", detail: { toolName, reason: "invalid args", rawArgs } });
    return { result: message, ok: false };
  }

  logEvent({ ...audit, eventType: "tool_call_started", detail: { toolName, args: parsed.data } });
  const started = Date.now();
  try {
    const result = await tool.handler(parsed.data, ctx);
    logEvent({
      ...audit,
      eventType: "tool_call_completed",
      detail: {
        toolName,
        args: parsed.data,
        durationMs: Date.now() - started,
        resultPreview: result.slice(0, 500),
        resultChars: result.length,
      },
    });
    return { result, ok: true };
  } catch (err) {
    const violation = err instanceof SandboxViolation;
    const message = err instanceof Error ? err.message : String(err);
    logEvent({
      ...audit,
      eventType: violation ? "tool_sandbox_violation" : "tool_call_failed",
      detail: { toolName, args: parsed.data, error: message },
    });
    if (violation) console.warn(`sandbox violation by ${ctx.agentId} via ${toolName}: ${message}`);
    return { result: `ERROR: ${message}`, ok: false };
  }
}

export { ToolPermissionError };
