/**
 * Autonomous routines (spec item 6). Each declares a cron schedule and a
 * handler; the scheduler records every run in routine_runs so autonomous
 * activity is as auditable as anything the owner triggers.
 */
import { runAgent } from "../agents/executor";
import { logEvent } from "../audit";
import { addDocument } from "../brain";
import { getDb } from "../db";
import { compactAllMemories } from "../memory";
import { createGoal, executeGoal } from "../orchestration/goals";

export interface RoutineContext {
  workspaceId: string;
  trigger: "schedule" | "manual";
}

export interface RoutineResult {
  summary: string;
  goalId?: string;
  costUsd?: number;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  cron: string;
  handler: (ctx: RoutineContext) => Promise<RoutineResult>;
}

/** Snapshot of yesterday/last week used by the briefing routines. */
function activitySince(workspaceId: string, sinceIso: string): string {
  const db = getDb();
  const goals = db
    .prepare(
      "SELECT description, status FROM goals WHERE workspace_id = ? AND created_at >= ? ORDER BY created_at"
    )
    .all(workspaceId, sinceIso) as { description: string; status: string }[];
  const tasks = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND created_at >= ? GROUP BY status`
    )
    .all(workspaceId, sinceIso) as { status: string; n: number }[];
  const approvals = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM approvals WHERE workspace_id = ? AND created_at >= ? GROUP BY status`
    )
    .all(workspaceId, sinceIso) as { status: string; n: number }[];
  const escalations = db
    .prepare(
      "SELECT COUNT(*) AS n FROM escalations WHERE workspace_id = ? AND status = 'open'"
    )
    .get(workspaceId) as { n: number };
  const spend = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ?")
    .get(sinceIso) as { usd: number };

  return [
    `Goals: ${goals.length === 0 ? "none" : goals.map((g) => `"${g.description}" (${g.status})`).join("; ")}`,
    `Tasks by status: ${tasks.length === 0 ? "none" : tasks.map((t) => `${t.status}=${t.n}`).join(", ")}`,
    `Approvals: ${approvals.length === 0 ? "none" : approvals.map((a) => `${a.status}=${a.n}`).join(", ")}`,
    `Open escalations awaiting the owner: ${escalations.n}`,
    `LLM spend in period: $${spend.usd.toFixed(4)}`,
  ].join("\n");
}

const daysAgoIso = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export const ROUTINES: Routine[] = [
  {
    id: "daily_standup",
    name: "Daily standup brief",
    description: "Chief of Staff writes the owner's morning brief: what happened, what's blocked, what needs a decision.",
    cron: "0 9 * * *",
    handler: async (ctx) => {
      const activity = activitySince(ctx.workspaceId, daysAgoIso(1));
      const run = await runAgent(
        "chief_of_staff",
        `Write today's standup brief for the owner, covering the last 24 hours.\n\n` +
          `COMPANY ACTIVITY:\n${activity}\n\n` +
          `Structure it as: What happened / What's blocked / What needs your decision / ` +
          `Key numbers. Keep it under 250 words. If a section has nothing, say "nothing" ` +
          `rather than padding it.`,
        { workspaceId: ctx.workspaceId }
      );
      return { summary: run.output, costUsd: run.usage.costUsd };
    },
  },
  {
    id: "daily_content",
    name: "Daily content generation",
    description: "CMO plans and the content team produces the day's marketing assets, which land in the approval queue.",
    cron: "0 10 * * 1-5",
    handler: async (ctx) => {
      const goalId = createGoal(
        ctx.workspaceId,
        "Produce today's marketing content: pick one theme grounded in the company " +
          "knowledge base, then create one social post and one short-form video script " +
          "for it. Keep both consistent with each other and the brand voice."
      );
      const report = await executeGoal(goalId);
      return {
        summary: report.report,
        goalId,
        costUsd: report.totalCostUsd,
      };
    },
  },
  {
    id: "weekly_metrics",
    name: "Weekly metrics report",
    description: "Analyst reviews the week's numbers and writes the insight behind them.",
    cron: "0 9 * * 1",
    handler: async (ctx) => {
      const activity = activitySince(ctx.workspaceId, daysAgoIso(7));
      const run = await runAgent(
        "analyst",
        `Write the weekly metrics report for the owner.\n\nLAST 7 DAYS:\n${activity}\n\n` +
          `Use your db_query tool to look deeper where useful. Answer: what changed, ` +
          `why it likely changed, and what to do about it. State clearly where data is ` +
          `missing rather than estimating.`,
        { workspaceId: ctx.workspaceId }
      );
      return { summary: run.output, costUsd: run.usage.costUsd };
    },
  },
  {
    id: "weekly_hr_review",
    name: "Weekly agent performance review",
    description: "HR reviewer scores agent performance from the audit trail and proposes prompt improvements for the owner to approve.",
    cron: "0 16 * * 5",
    handler: async (ctx) => {
      const db = getDb();
      const perf = db
        .prepare(
          `SELECT agent_id,
                  COUNT(*) AS runs,
                  SUM(event_type = 'agent_run_failed') AS failures
             FROM audit_log
            WHERE workspace_id = ? AND created_at >= ?
              AND event_type IN ('agent_run_completed', 'agent_run_failed')
            GROUP BY agent_id ORDER BY runs DESC LIMIT 15`
        )
        .all(ctx.workspaceId, daysAgoIso(7)) as {
        agent_id: string;
        runs: number;
        failures: number;
      }[];
      const revisions = db
        .prepare(
          `SELECT producer_id, COUNT(*) AS revisions FROM reviews
            WHERE workspace_id = ? AND verdict = 'REVISE' AND created_at >= ?
            GROUP BY producer_id ORDER BY revisions DESC`
        )
        .all(ctx.workspaceId, daysAgoIso(7)) as { producer_id: string; revisions: number }[];

      const run = await runAgent(
        "hr_reviewer",
        `Score agent performance for the past week and propose prompt improvements.\n\n` +
          `RUNS: ${perf.length === 0 ? "no activity" : perf.map((p) => `${p.agent_id}: ${p.runs} runs, ${p.failures} failed`).join("; ")}\n` +
          `REVISIONS REQUESTED: ${revisions.length === 0 ? "none" : revisions.map((r) => `${r.producer_id}: ${r.revisions}`).join("; ")}\n\n` +
          `For the two or three weakest agents, quote the specific prompt line you would ` +
          `change and give the replacement text, with the evidence motivating it. ` +
          `You propose — the owner approves.`,
        { workspaceId: ctx.workspaceId }
      );
      return { summary: run.output, costUsd: run.usage.costUsd };
    },
  },
  {
    id: "monthly_pnl",
    name: "Monthly P&L",
    description: "Bookkeeper produces the monthly profit and loss summary including API spend.",
    cron: "0 8 1 * *",
    handler: async (ctx) => {
      const spend = getDb()
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS calls
             FROM llm_calls WHERE created_at >= ?`
        )
        .get(daysAgoIso(31)) as { usd: number; calls: number };
      const run = await runAgent(
        "bookkeeper",
        `Produce the monthly P&L summary.\n\n` +
          `KNOWN COSTS: LLM/API spend $${spend.usd.toFixed(4)} across ${spend.calls} calls ` +
          `in the last 31 days.\n\n` +
          `Revenue and non-API expenses are not yet connected to any system. Present the ` +
          `structure of the P&L with the API cost filled in, mark every unavailable line ` +
          `as "not connected" rather than assuming zero, and state what needs wiring up.`,
        { workspaceId: ctx.workspaceId }
      );
      return { summary: run.output, costUsd: run.usage.costUsd };
    },
  },
  {
    id: "memory_compaction",
    name: "Memory compaction",
    description: "Folds each agent's older episodes into a durable summary so context never overflows.",
    cron: "30 3 * * *",
    handler: async (ctx) => {
      const folded = await compactAllMemories(ctx.workspaceId);
      return {
        summary:
          folded === 0
            ? "No agent had enough episodes to compact."
            : `Compacted ${folded} episode(s) into per-agent summaries.`,
      };
    },
  },
];

export function getRoutine(id: string): Routine | undefined {
  return ROUTINES.find((r) => r.id === id);
}

/**
 * Run a routine and record it. Briefings are also filed into the Company Brain
 * so future agents can retrieve what the business decided and reported.
 */
export async function runRoutine(
  routine: Routine,
  ctx: RoutineContext
): Promise<{ runId: number; status: string; summary: string }> {
  const db = getDb();
  const info = db
    .prepare(
      "INSERT INTO routine_runs (routine_id, workspace_id, trigger) VALUES (?, ?, ?)"
    )
    .run(routine.id, ctx.workspaceId, ctx.trigger);
  const runId = Number(info.lastInsertRowid);

  logEvent({
    workspaceId: ctx.workspaceId,
    eventType: "routine_started",
    detail: { routineId: routine.id, runId, trigger: ctx.trigger },
  });
  console.log(`routine ${routine.id} started (${ctx.trigger})`);

  try {
    const result = await routine.handler(ctx);
    db.prepare(
      `UPDATE routine_runs SET status = 'completed', summary = ?, goal_id = ?, cost_usd = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    ).run(result.summary, result.goalId ?? null, result.costUsd ?? 0, runId);

    // File written briefings into the knowledge base as company memory.
    if (["daily_standup", "weekly_metrics", "monthly_pnl"].includes(routine.id)) {
      try {
        await addDocument({
          workspaceId: ctx.workspaceId,
          title: `${routine.name} — ${new Date().toISOString().slice(0, 10)}`,
          content: result.summary,
          source: "agent",
        });
      } catch (err) {
        console.error(
          `could not file ${routine.id} into the knowledge base: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    logEvent({
      workspaceId: ctx.workspaceId,
      eventType: "routine_completed",
      detail: { routineId: routine.id, runId, costUsd: result.costUsd ?? 0 },
    });
    console.log(`routine ${routine.id} completed`);
    return { runId, status: "completed", summary: result.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE routine_runs SET status = 'failed', error = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    ).run(message, runId);
    logEvent({
      workspaceId: ctx.workspaceId,
      eventType: "routine_failed",
      detail: { routineId: routine.id, runId, error: message },
    });
    console.error(`routine ${routine.id} failed: ${message}`);
    return { runId, status: "failed", summary: message };
  }
}
