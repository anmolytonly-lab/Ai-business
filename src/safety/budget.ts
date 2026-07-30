/**
 * Budget guard: per-task, per-agent and daily spend caps.
 * Per-task is enforced by the executor against the agent's maxCostPerTask;
 * this module owns the per-agent-per-day and company-wide daily caps, and
 * raises the 80% alert before the hard stop.
 */
import { logEvent } from "../audit";
import { env } from "../config/env";
import { getDb } from "../db";
import { workspaceDailyBudget } from "../workspace";

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly scope: "daily" | "agent" | "workspace"
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

const ALERT_THRESHOLD = 0.8;

const today = (): string => new Date().toISOString().slice(0, 10);

export interface SpendSnapshot {
  date: string;
  dailySpendUsd: number;
  dailyBudgetUsd: number;
  dailyRemainingUsd: number;
  percentUsed: number;
  alertThresholdReached: boolean;
  agentDailyBudgetUsd: number;
  byAgent: { agentId: string; spendUsd: number; calls: number }[];
}

function spendSince(startOfDay: string, agentId?: string): number {
  const db = getDb();
  if (agentId === undefined) {
    return (
      db
        .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ?")
        .get(startOfDay) as { usd: number }
    ).usd;
  }
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ? AND agent_id = ?"
      )
      .get(startOfDay, agentId) as { usd: number }
  ).usd;
}

/** Raise the 80% alert at most once per day. */
function maybeAlert(spend: number): void {
  if (env.DAILY_BUDGET_USD <= 0) return;
  const ratio = spend / env.DAILY_BUDGET_USD;
  if (ratio < ALERT_THRESHOLD) return;

  const key = `budget_alert_${today()}`;
  const db = getDb();
  const seen = db.prepare("SELECT value FROM system_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (seen !== undefined) return;

  db.prepare("INSERT INTO system_state (key, value) VALUES (?, ?)").run(key, String(spend));
  const message =
    `BUDGET ALERT: $${spend.toFixed(4)} of $${env.DAILY_BUDGET_USD.toFixed(2)} daily budget used ` +
    `(${(ratio * 100).toFixed(0)}%).`;
  console.warn(message);
  logEvent({
    eventType: "budget_alert",
    detail: { spendUsd: spend, budgetUsd: env.DAILY_BUDGET_USD, percentUsed: ratio },
  });
}

/**
 * Called before every model call. Throws BudgetExceededError when a cap is
 * already met, so spend stops rather than overshooting.
 */
export function assertWithinBudget(agentId?: string, workspaceId?: string): void {
  const startOfDay = `${today()}T00:00:00`;
  const daily = spendSince(startOfDay);

  maybeAlert(daily);

  // A workspace may set its own daily cap; it applies on top of the global one.
  if (workspaceId !== undefined) {
    const cap = workspaceDailyBudget(workspaceId);
    if (cap !== null && cap > 0) {
      const wsSpend = (
        getDb()
          .prepare(
            "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ? AND workspace_id = ?"
          )
          .get(startOfDay, workspaceId) as { usd: number }
      ).usd;
      if (wsSpend >= cap) {
        logEvent({
          workspaceId,
          eventType: "budget_hard_stop",
          detail: { scope: "workspace", spendUsd: wsSpend, budgetUsd: cap },
        });
        throw new BudgetExceededError(
          `Workspace "${workspaceId}" has used $${wsSpend.toFixed(4)} of its $${cap.toFixed(
            2
          )} daily cap and is stopped for today.`,
          "workspace"
        );
      }
    }
  }

  if (env.DAILY_BUDGET_USD > 0 && daily >= env.DAILY_BUDGET_USD) {
    logEvent({
      eventType: "budget_hard_stop",
      detail: { scope: "daily", spendUsd: daily, budgetUsd: env.DAILY_BUDGET_USD },
    });
    throw new BudgetExceededError(
      `Daily budget exhausted: $${daily.toFixed(4)} of $${env.DAILY_BUDGET_USD.toFixed(2)} used. ` +
        `All agents are stopped until the budget resets or DAILY_BUDGET_USD is raised.`,
      "daily"
    );
  }

  if (agentId !== undefined && env.AGENT_DAILY_BUDGET_USD > 0) {
    const agentSpend = spendSince(startOfDay, agentId);
    if (agentSpend >= env.AGENT_DAILY_BUDGET_USD) {
      logEvent({
        agentId,
        eventType: "budget_hard_stop",
        detail: { scope: "agent", spendUsd: agentSpend, budgetUsd: env.AGENT_DAILY_BUDGET_USD },
      });
      throw new BudgetExceededError(
        `Agent "${agentId}" has used $${agentSpend.toFixed(4)} of its $${env.AGENT_DAILY_BUDGET_USD.toFixed(
          2
        )} daily cap and is stopped for today.`,
        "agent"
      );
    }
  }
}

export function getSpendSnapshot(): SpendSnapshot {
  const date = today();
  const startOfDay = `${date}T00:00:00`;
  const daily = spendSince(startOfDay);
  const byAgent = getDb()
    .prepare(
      `SELECT agent_id AS agentId, COALESCE(SUM(cost_usd), 0) AS spendUsd, COUNT(*) AS calls
         FROM llm_calls WHERE created_at >= ? AND agent_id IS NOT NULL
        GROUP BY agent_id ORDER BY spendUsd DESC`
    )
    .all(startOfDay) as { agentId: string; spendUsd: number; calls: number }[];

  const percentUsed = env.DAILY_BUDGET_USD > 0 ? daily / env.DAILY_BUDGET_USD : 0;
  return {
    date,
    dailySpendUsd: daily,
    dailyBudgetUsd: env.DAILY_BUDGET_USD,
    dailyRemainingUsd: Math.max(0, env.DAILY_BUDGET_USD - daily),
    percentUsed,
    alertThresholdReached: percentUsed >= ALERT_THRESHOLD,
    agentDailyBudgetUsd: env.AGENT_DAILY_BUDGET_USD,
    byAgent,
  };
}
