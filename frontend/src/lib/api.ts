/** Typed client for the AgentCorp API. */

const BASE = "/api";

/**
 * Selected workspace, sent on every request. Persisted so a reload keeps the
 * client you were looking at.
 */
let workspaceId = localStorage.getItem("agentcorp.workspace") ?? "default";

export function getWorkspaceId(): string {
  return workspaceId;
}

export function setWorkspaceId(id: string): void {
  workspaceId = id;
  localStorage.setItem("agentcorp.workspace", id);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Id": workspaceId,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface Status {
  phase: number;
  agentsLoaded: number;
  documentsIndexed: number;
  chunksIndexed: number;
  handbookLoaded: boolean;
  llmCallsLogged: number;
  todaySpendUsd: number;
  killSwitchEngaged: boolean;
  pendingApprovals: number;
  geminiKeyConfigured: boolean;
  vectorSearch: boolean;
}

export interface Agent {
  id: string;
  name: string;
  department: string;
  role: string;
  reportsTo: string;
  canDelegateTo: string[];
  model: string;
  tools: string[];
  requiresApproval: string[];
}

export interface AgentStatus {
  agentId: string;
  activity: "idle" | "working" | "reviewing";
  taskId?: string;
  detail?: string;
  since: string;
}

export interface Goal {
  id: string;
  description: string;
  status: string;
  report: string | null;
  delegation_round: number;
  created_at: string;
  completed_at: string | null;
}

export interface Task {
  id: string;
  goal_id: string;
  agent_id: string;
  instruction: string;
  acceptance_criteria: string | null;
  depends_on: string;
  status: string;
  result: string | null;
  revision_round: number;
  created_at: string;
}

export interface Approval {
  id: string;
  agent_id: string;
  task_id: string | null;
  action_type: string;
  status: string;
  payload: { content: string; context: string; gatedActions: string[] };
  legal_flags: string[];
  legal_assessment: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface Escalation {
  id: string;
  task_id: string;
  producer_id: string;
  reviewer_id: string;
  reason: string;
  deliverable: string;
  status: string;
  created_at: string;
}

export interface AuditRow {
  id: number;
  agent_id: string | null;
  task_id: string | null;
  event_type: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Budget {
  date: string;
  dailySpendUsd: number;
  dailyBudgetUsd: number;
  dailyRemainingUsd: number;
  percentUsed: number;
  alertThresholdReached: boolean;
  agentDailyBudgetUsd: number;
  byAgent: { agentId: string; spendUsd: number; calls: number }[];
}

export interface ChatReply {
  reply: string;
  isGoal: boolean;
  suggestedGoal: string;
}

export interface Document {
  id: string;
  title: string;
  source: string;
  needs_review: number;
  chunks: number;
  created_at: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "usd";
  connected: boolean;
  hint?: string;
  previous?: number | null;
}

export interface KpiSnapshot {
  generatedAt: string;
  periodDays: number;
  kpis: Kpi[];
  spendByDay: { date: string; usd: number }[];
  tasksByStatus: { status: string; count: number }[];
  topAgents: { agentId: string; runs: number; costUsd: number }[];
}

export interface RoutineRun {
  id: number;
  routine_id: string;
  status: string;
  trigger: string;
  summary: string | null;
  error: string | null;
  cost_usd: number;
  started_at: string;
  finished_at: string | null;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun: RoutineRun | null;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  daily_budget_usd: number | null;
  archived: number;
  created_at: string;
  goals: number;
  documents: number;
  spendTodayUsd: number;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  requiredEnv: string[];
  configured: boolean;
}

export interface AgentFull {
  id: string;
  name: string;
  department: string;
  role: string;
  systemPrompt: string;
  tools: string[];
  reportsTo: string;
  canDelegateTo: string[];
  model: string;
  temperature: number;
  maxCostPerTask: number;
  requiresApproval: string[];
}

export const api = {
  status: () => request<Status>("/status"),
  workspaces: () => request<Workspace[]>("/workspaces"),
  createWorkspace: (body: {
    id: string;
    name: string;
    description?: string;
    dailyBudgetUsd?: number | null;
  }) => request<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
  updateWorkspace: (id: string, body: Record<string, unknown>) =>
    request<Workspace>(`/workspaces/${id}`, { method: "POST", body: JSON.stringify(body) }),
  integrations: () => request<Integration[]>("/integrations"),
  testIntegration: (id: string) =>
    request<{ configured: boolean; message: string; missing: string[] }>(
      `/integrations/${id}/test`,
      { method: "POST" }
    ),
  agentFull: (id: string) => request<AgentFull>(`/agents/${id}`),
  saveAgent: (id: string, body: AgentFull, scopeToWorkspace = false) =>
    request<AgentFull>(`/agents/${id}${scopeToWorkspace ? "" : "?workspace=default"}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  createAgent: (body: AgentFull) =>
    request<AgentFull>("/agents", { method: "POST", body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),
  tools: () =>
    request<{ tools: { name: string; description: string; external: boolean }[] }>("/tools"),
  kpis: (days = 7) => request<KpiSnapshot>(`/kpis?days=${days}`),
  routines: () => request<Routine[]>("/routines"),
  routineRuns: () => request<RoutineRun[]>("/routines/runs"),
  runRoutine: (id: string) =>
    request<{ runId: number; status: string; summary: string }>(`/routines/${id}/run`, {
      method: "POST",
    }),
  agents: () => request<Agent[]>("/agents"),
  agentStatuses: () => request<AgentStatus[]>("/agents/status"),
  goals: () => request<Goal[]>("/goals"),
  goal: (id: string) => request<Goal & { tasks: Task[] }>(`/goals/${id}`),
  createGoal: (description: string) =>
    request<{ goalId: string }>("/goals", {
      method: "POST",
      body: JSON.stringify({ description }),
    }),
  approvals: (status = "pending") => request<Approval[]>(`/approvals?status=${status}`),
  decideApproval: (id: string, decision: "approved" | "rejected", note: string) =>
    request<{ ok: boolean }>(`/approvals/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  escalations: () => request<Escalation[]>("/escalations"),
  resolveEscalation: (id: string, status: "resolved" | "dismissed", resolution: string) =>
    request<{ ok: boolean }>(`/escalations/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, resolution }),
    }),
  audit: (limit = 100) => request<AuditRow[]>(`/audit?limit=${limit}`),
  budget: () => request<Budget>("/budget"),
  killSwitch: () => request<{ engaged: boolean }>("/kill-switch"),
  setKillSwitch: (engaged: boolean, reason = "") =>
    request<{ engaged: boolean }>("/kill-switch", {
      method: "POST",
      body: JSON.stringify({ engaged, reason }),
    }),
  chat: (message: string, history: { role: "owner" | "ceo"; content: string }[]) =>
    request<ChatReply>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
  documents: () => request<Document[]>("/documents"),
  addDocument: (title: string, content: string) =>
    request<{ documentId: string; chunks: number }>("/documents", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    }),
  approveDocument: (id: string) =>
    request<{ ok: boolean }>(`/documents/${id}/approve`, { method: "POST" }),
};
