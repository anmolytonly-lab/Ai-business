/**
 * Live per-agent status for the org chart. In-memory: it describes what is
 * happening right now, and a restart correctly shows everyone idle.
 */
export type AgentActivity = "idle" | "working" | "reviewing";

export interface AgentStatus {
  agentId: string;
  activity: AgentActivity;
  taskId?: string;
  detail?: string;
  since: string;
}

const statuses = new Map<string, AgentStatus>();

export function setAgentStatus(
  agentId: string,
  activity: AgentActivity,
  opts: { taskId?: string; detail?: string } = {}
): void {
  if (activity === "idle") {
    statuses.delete(agentId);
    return;
  }
  statuses.set(agentId, {
    agentId,
    activity,
    ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
    ...(opts.detail !== undefined ? { detail: opts.detail.slice(0, 160) } : {}),
    since: new Date().toISOString(),
  });
}

export function getAgentStatus(agentId: string): AgentStatus | undefined {
  return statuses.get(agentId);
}

export function listAgentStatuses(): AgentStatus[] {
  return [...statuses.values()];
}
