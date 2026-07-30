/**
 * Workspaces: one per business or client. Knowledge base, goals, tasks,
 * approvals, memory and budget are all isolated by workspace_id; agent config
 * can be overridden per workspace on top of the shared roster.
 */
import { logEvent } from "./audit";
import { getDb } from "./db";

export const DEFAULT_WORKSPACE_ID = "default";

export interface WorkspaceRow {
  id: string;
  name: string;
  description: string;
  daily_budget_usd: number | null;
  archived: number;
  created_at: string;
}

/** Workspace ids become directory names for agent overrides — keep them safe. */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;

export function isValidWorkspaceId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function ensureDefaultWorkspace(): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)")
    .run(DEFAULT_WORKSPACE_ID, "Default Workspace");
}

export function listWorkspaces(includeArchived = false): (WorkspaceRow & {
  goals: number;
  documents: number;
  spendTodayUsd: number;
})[] {
  const rows = getDb()
    .prepare(
      `SELECT w.*,
              (SELECT COUNT(*) FROM goals g WHERE g.workspace_id = w.id) AS goals,
              (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id) AS documents,
              (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls l
                WHERE l.workspace_id = w.id
                  AND l.created_at >= strftime('%Y-%m-%dT00:00:00', 'now')) AS spendTodayUsd
         FROM workspaces w
        WHERE (? = 1 OR w.archived = 0)
        ORDER BY w.created_at`
    )
    .all(includeArchived ? 1 : 0) as (WorkspaceRow & {
    goals: number;
    documents: number;
    spendTodayUsd: number;
  })[];
  return rows;
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
    | WorkspaceRow
    | undefined;
}

export function workspaceExists(id: string): boolean {
  return getWorkspace(id) !== undefined;
}

export function createWorkspace(opts: {
  id: string;
  name: string;
  description?: string;
  dailyBudgetUsd?: number | null;
}): WorkspaceRow {
  if (!isValidWorkspaceId(opts.id)) {
    throw new Error(
      `invalid workspace id "${opts.id}" — use lowercase letters, digits, hyphen or underscore (max 49 chars)`
    );
  }
  if (workspaceExists(opts.id)) throw new Error(`workspace "${opts.id}" already exists`);
  if (opts.name.trim() === "") throw new Error("workspace name must not be empty");

  getDb()
    .prepare(
      "INSERT INTO workspaces (id, name, description, daily_budget_usd) VALUES (?, ?, ?, ?)"
    )
    .run(opts.id, opts.name.trim(), opts.description ?? "", opts.dailyBudgetUsd ?? null);
  logEvent({ workspaceId: opts.id, eventType: "workspace_created", detail: { name: opts.name } });
  return getWorkspace(opts.id) as WorkspaceRow;
}

export function updateWorkspace(
  id: string,
  patch: { name?: string; description?: string; dailyBudgetUsd?: number | null; archived?: boolean }
): WorkspaceRow | undefined {
  const existing = getWorkspace(id);
  if (existing === undefined) return undefined;
  getDb()
    .prepare(
      `UPDATE workspaces SET name = ?, description = ?, daily_budget_usd = ?, archived = ?
        WHERE id = ?`
    )
    .run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.dailyBudgetUsd === undefined ? existing.daily_budget_usd : patch.dailyBudgetUsd,
      patch.archived === undefined ? existing.archived : patch.archived ? 1 : 0,
      id
    );
  logEvent({ workspaceId: id, eventType: "workspace_updated", detail: { ...patch } });
  return getWorkspace(id);
}

/** Per-workspace daily cap, falling back to the global one when unset. */
export function workspaceDailyBudget(id: string): number | null {
  const row = getWorkspace(id);
  return row?.daily_budget_usd ?? null;
}
