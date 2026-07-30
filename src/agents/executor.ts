/**
 * Single-agent execution (Phase 2). Runs one agent against one instruction:
 * the agent's own systemPrompt, model and temperature go to the provider,
 * every step is written to the audit log, and cost is checked against the
 * agent's maxCostPerTask.
 */
import crypto from "node:crypto";
import { logEvent } from "../audit";
import { generateText } from "../llm/provider";
import { LlmUsage } from "../llm/types";
import { getAgent } from "./registry";

export interface RunContext {
  workspaceId?: string;
  taskId?: string;
}

export interface AgentRunResult {
  runId: string;
  agentId: string;
  output: string;
  usage: LlmUsage;
  /** True when the run's cost exceeded the agent's maxCostPerTask. */
  overBudget: boolean;
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
  const base = {
    agentId: agent.id,
    ...(ctx.workspaceId !== undefined ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
  };

  logEvent({
    ...base,
    eventType: "agent_run_started",
    detail: { runId, instruction, model: agent.model },
  });

  try {
    const result = await generateText(instruction, {
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      temperature: agent.temperature,
      agentId: agent.id,
      purpose: `agent-run:${runId}`,
      ...(ctx.workspaceId !== undefined ? { workspaceId: ctx.workspaceId } : {}),
      ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
    });

    const overBudget = result.usage.costUsd > agent.maxCostPerTask;
    if (overBudget) {
      logEvent({
        ...base,
        eventType: "agent_over_budget",
        detail: {
          runId,
          costUsd: result.usage.costUsd,
          maxCostPerTask: agent.maxCostPerTask,
        },
      });
    }

    logEvent({
      ...base,
      eventType: "agent_run_completed",
      detail: {
        runId,
        outputPreview: result.text.slice(0, 300),
        outputChars: result.text.length,
        costUsd: result.usage.costUsd,
        latencyMs: result.usage.latencyMs,
      },
    });

    return { runId, agentId: agent.id, output: result.text, usage: result.usage, overBudget };
  } catch (err) {
    logEvent({
      ...base,
      eventType: "agent_run_failed",
      detail: { runId, error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
