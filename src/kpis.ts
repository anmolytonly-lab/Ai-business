/**
 * Dashboard KPIs. Metrics with no data source yet report `connected: false`
 * rather than a zero — a fabricated 0 would read as "no revenue" instead of
 * "no payment integration", and the dashboard must not imply data it lacks.
 */
import { getDb } from "./db";

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "usd";
  /** False when nothing feeds this metric yet (integrations land in Phase 10). */
  connected: boolean;
  hint?: string;
  /** Previous comparable period, for a delta. Null when not comparable. */
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

const daysAgoIso = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export function getKpis(workspaceId: string, periodDays = 7): KpiSnapshot {
  const db = getDb();
  const since = daysAgoIso(periodDays);
  const prevSince = daysAgoIso(periodDays * 2);

  const countTasks = (from: string, to?: string): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM tasks
            WHERE workspace_id = ? AND status = 'completed' AND completed_at >= ?
              ${to === undefined ? "" : "AND completed_at < ?"}`
        )
        .get(...(to === undefined ? [workspaceId, from] : [workspaceId, from, to])) as {
        n: number;
      }
    ).n;

  const countShipped = (from: string, to?: string): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM approvals
            WHERE workspace_id = ? AND status = 'approved' AND decided_at >= ?
              ${to === undefined ? "" : "AND decided_at < ?"}`
        )
        .get(...(to === undefined ? [workspaceId, from] : [workspaceId, from, to])) as {
        n: number;
      }
    ).n;

  const spend = (from: string, to?: string): number =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls
            WHERE created_at >= ? ${to === undefined ? "" : "AND created_at < ?"}`
        )
        .get(...(to === undefined ? [from] : [from, to])) as { usd: number }
    ).usd;

  const goalsCompleted = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM goals WHERE workspace_id = ? AND status = 'completed' AND completed_at >= ?"
      )
      .get(workspaceId, since) as { n: number }
  ).n;

  const pendingApprovals = (
    db
      .prepare("SELECT COUNT(*) AS n FROM approvals WHERE workspace_id = ? AND status = 'pending'")
      .get(workspaceId) as { n: number }
  ).n;

  const openEscalations = (
    db
      .prepare("SELECT COUNT(*) AS n FROM escalations WHERE workspace_id = ? AND status = 'open'")
      .get(workspaceId) as { n: number }
  ).n;

  const kpis: Kpi[] = [
    {
      key: "revenue",
      label: "Revenue",
      value: null,
      unit: "usd",
      connected: false,
      hint: "No payment integration connected yet (Phase 10: Razorpay/Stripe).",
    },
    {
      key: "leads",
      label: "Leads",
      value: null,
      unit: "count",
      connected: false,
      hint: "No CRM or form integration connected yet (Phase 10).",
    },
    {
      key: "content_shipped",
      label: "Content shipped",
      value: countShipped(since),
      previous: countShipped(prevSince, since),
      unit: "count",
      connected: true,
      hint: "Outbound items you approved in this period.",
    },
    {
      key: "tasks_completed",
      label: "Tasks completed",
      value: countTasks(since),
      previous: countTasks(prevSince, since),
      unit: "count",
      connected: true,
    },
    {
      key: "goals_completed",
      label: "Goals completed",
      value: goalsCompleted,
      unit: "count",
      connected: true,
    },
    {
      key: "spend",
      label: "AI spend",
      value: spend(since),
      previous: spend(prevSince, since),
      unit: "usd",
      connected: true,
      hint: "Token cost across every agent call in this period.",
    },
    {
      key: "pending_approvals",
      label: "Awaiting you",
      value: pendingApprovals + openEscalations,
      unit: "count",
      connected: true,
      hint: "Approvals plus escalations that need a decision.",
    },
  ];

  const spendByDay = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date, COALESCE(SUM(cost_usd), 0) AS usd
         FROM llm_calls WHERE created_at >= ?
        GROUP BY date ORDER BY date`
    )
    .all(daysAgoIso(14)) as { date: string; usd: number }[];

  const tasksByStatus = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM tasks WHERE workspace_id = ?
        GROUP BY status ORDER BY count DESC`
    )
    .all(workspaceId) as { status: string; count: number }[];

  const topAgents = db
    .prepare(
      `SELECT agent_id AS agentId, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS costUsd
         FROM llm_calls WHERE created_at >= ? AND agent_id IS NOT NULL
        GROUP BY agent_id ORDER BY costUsd DESC LIMIT 8`
    )
    .all(since) as { agentId: string; runs: number; costUsd: number }[];

  return {
    generatedAt: new Date().toISOString(),
    periodDays,
    kpis,
    spendByDay,
    tasksByStatus,
    topAgents,
  };
}
