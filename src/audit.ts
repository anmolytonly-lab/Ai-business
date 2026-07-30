import { getDb } from "./db";

export interface AuditEvent {
  workspaceId?: string;
  agentId?: string;
  taskId?: string;
  eventType: string;
  detail?: Record<string, unknown>;
}

export interface AuditRow {
  id: number;
  workspace_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  event_type: string;
  detail: string;
  created_at: string;
}

/** Append an event to the audit trail. Nothing an agent does is invisible. */
export function logEvent(event: AuditEvent): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (workspace_id, agent_id, task_id, event_type, detail)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      event.workspaceId ?? null,
      event.agentId ?? null,
      event.taskId ?? null,
      event.eventType,
      JSON.stringify(event.detail ?? {})
    );
}

export function getAuditLog(opts: {
  limit?: number;
  agentId?: string;
  eventType?: string;
} = {}): AuditRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.agentId !== undefined) {
    where.push("agent_id = ?");
    params.push(opts.agentId);
  }
  if (opts.eventType !== undefined) {
    where.push("event_type = ?");
    params.push(opts.eventType);
  }
  const sql = `SELECT * FROM audit_log ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  return getDb().prepare(sql).all(...params) as AuditRow[];
}
