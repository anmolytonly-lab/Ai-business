/**
 * TaskRunner: executes a goal's task DAG respecting dependencies, running
 * independent tasks in parallel (bounded concurrency). A failed task marks
 * its transitive dependents blocked; independent branches keep going.
 */
import { logEvent } from "../audit";
import { getDb } from "../db";
import { produceWithReview } from "./critic";
import { GoalRow } from "./planner";

const CONCURRENCY = 3;
/** Dependency outputs injected into an instruction are truncated to this. */
const DEP_OUTPUT_CHARS = 2500;

export interface TaskRow {
  id: string;
  goal_id: string;
  workspace_id: string;
  agent_id: string;
  instruction: string;
  acceptance_criteria: string | null;
  depends_on: string;
  status: string;
  result: string | null;
  revision_round: number;
  created_at: string;
  completed_at: string | null;
}

export interface GoalReport {
  goalId: string;
  status: "completed" | "failed";
  tasks: { id: string; agentId: string; status: string }[];
  completed: number;
  failed: number;
  blocked: number;
  escalated: number;
  totalCostUsd: number;
  report: string;
}

function buildTaskPrompt(task: TaskRow, depOutputs: { id: string; agentId: string; output: string }[]): string {
  let prompt = `Your task: ${task.instruction}`;
  if (task.acceptance_criteria !== null && task.acceptance_criteria !== "") {
    prompt += `\n\nAcceptance criteria your deliverable must meet:\n${task.acceptance_criteria}`;
  }
  if (depOutputs.length > 0) {
    prompt += `\n\nContext — outputs from tasks yours depends on:`;
    for (const dep of depOutputs) {
      const truncated =
        dep.output.length > DEP_OUTPUT_CHARS
          ? `${dep.output.slice(0, DEP_OUTPUT_CHARS)}\n[...truncated]`
          : dep.output;
      prompt += `\n\n--- from ${dep.agentId} (task ${dep.id}) ---\n${truncated}`;
    }
  }
  return prompt;
}

export async function runGoal(goalId: string): Promise<GoalReport> {
  const db = getDb();
  const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as
    | GoalRow
    | undefined;
  if (goal === undefined) throw new Error(`unknown goal "${goalId}"`);

  const tasks = db
    .prepare("SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at")
    .all(goalId) as TaskRow[];
  if (tasks.length === 0) throw new Error(`goal "${goalId}" has no tasks — plan it first`);

  db.prepare("UPDATE goals SET status = 'running' WHERE id = ?").run(goalId);
  logEvent({ workspaceId: goal.workspace_id, eventType: "goal_run_started", detail: { goalId, taskCount: tasks.length } });

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deps = new Map(tasks.map((t) => [t.id, JSON.parse(t.depends_on) as string[]]));
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const outputs = new Map<string, string>();
  const inFlight = new Map<string, Promise<void>>();

  const setStatus = (taskId: string, s: string, result?: string): void => {
    status.set(taskId, s);
    if (result !== undefined) {
      db.prepare(
        "UPDATE tasks SET status = ?, result = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(s, result, taskId);
    } else {
      db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(s, taskId);
    }
  };

  const isReady = (t: TaskRow): boolean =>
    status.get(t.id) === "pending" &&
    (deps.get(t.id) ?? []).every((d) => status.get(d) === "completed");

  /**
   * A pending task is doomed if any transitive dependency failed, was blocked,
   * or was escalated — downstream work must never be built on a deliverable
   * that is still waiting on a human decision.
   */
  const isDoomed = (t: TaskRow): boolean =>
    (deps.get(t.id) ?? []).some((d) => {
      const s = status.get(d);
      if (s === "failed" || s === "blocked" || s === "escalated") return true;
      const depTask = byId.get(d);
      return depTask !== undefined && s === "pending" && isDoomed(depTask);
    });

  const launch = (t: TaskRow): void => {
    setStatus(t.id, "running");
    const depOutputs = (deps.get(t.id) ?? []).map((d) => ({
      id: d,
      agentId: byId.get(d)?.agent_id ?? "unknown",
      output: outputs.get(d) ?? "",
    }));
    // Every deliverable goes through the critic loop before it counts as done.
    const promise = produceWithReview({
      taskId: t.id,
      goalId: t.goal_id,
      workspaceId: t.workspace_id,
      producerId: t.agent_id,
      instruction: t.instruction,
      acceptanceCriteria: t.acceptance_criteria ?? "",
      basePrompt: buildTaskPrompt(t, depOutputs),
    })
      .then((res) => {
        // Escalated work is still passed downstream — it exists, it just
        // needs a human decision, which is recorded in the escalations table.
        outputs.set(t.id, res.output);
        setStatus(t.id, res.status === "escalated" ? "escalated" : "completed", res.output);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(t.id, "failed", `ERROR: ${message}`);
        console.error(`task ${t.id} (${t.agent_id}) failed: ${message}`);
      })
      .finally(() => {
        inFlight.delete(t.id);
      });
    inFlight.set(t.id, promise);
  };

  while (true) {
    // Mark tasks that can never run because a dependency failed.
    for (const t of tasks) {
      if (status.get(t.id) === "pending" && isDoomed(t)) setStatus(t.id, "blocked");
    }
    while (inFlight.size < CONCURRENCY) {
      const next = tasks.find((t) => isReady(t) && !inFlight.has(t.id));
      if (next === undefined) break;
      launch(next);
    }
    if (inFlight.size === 0) break; // nothing running, nothing ready — done
    await Promise.race(inFlight.values());
  }

  const counts = { completed: 0, failed: 0, blocked: 0, escalated: 0, other: 0 };
  for (const s of status.values()) {
    if (s === "completed") counts.completed++;
    else if (s === "failed") counts.failed++;
    else if (s === "blocked") counts.blocked++;
    else if (s === "escalated") counts.escalated++;
    else counts.other++;
  }

  const cost = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE task_id IN (SELECT id FROM tasks WHERE goal_id = ?)"
    )
    .get(goalId) as { usd: number };

  const finalStatus: GoalReport["status"] =
    counts.failed === 0 && counts.blocked === 0 && counts.escalated === 0 && counts.other === 0
      ? "completed"
      : "failed";

  const reviewStats = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(verdict = 'REVISE') AS revisions
       FROM reviews WHERE task_id IN (SELECT id FROM tasks WHERE goal_id = ?)`
    )
    .get(goalId) as { total: number; revisions: number | null };

  const lines = [
    `Goal ${finalStatus.toUpperCase()}: ${goal.description}`,
    `Tasks: ${counts.completed}/${tasks.length} completed` +
      (counts.failed > 0 ? `, ${counts.failed} failed` : "") +
      (counts.blocked > 0 ? `, ${counts.blocked} blocked` : "") +
      (counts.escalated > 0 ? `, ${counts.escalated} escalated to you` : ""),
    `Reviews: ${reviewStats.total} (${reviewStats.revisions ?? 0} sent back for revision)`,
    `Total LLM cost: $${cost.usd.toFixed(4)}`,
    "",
    ...tasks.map((t) => `- [${status.get(t.id)}] ${t.id} (${t.agent_id}): ${t.instruction.slice(0, 100)}`),
  ];
  if (counts.escalated > 0) {
    lines.push("", `${counts.escalated} deliverable(s) need your decision — see GET /api/escalations`);
  }
  const report = lines.join("\n");

  db.prepare(
    "UPDATE goals SET status = ?, report = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(finalStatus, report, goalId);
  logEvent({
    workspaceId: goal.workspace_id,
    eventType: finalStatus === "completed" ? "goal_completed" : "goal_failed",
    detail: { goalId, ...counts, totalCostUsd: cost.usd },
  });

  return {
    goalId,
    status: finalStatus,
    tasks: tasks.map((t) => ({ id: t.id, agentId: t.agent_id, status: status.get(t.id) ?? "unknown" })),
    completed: counts.completed,
    failed: counts.failed,
    blocked: counts.blocked,
    escalated: counts.escalated,
    totalCostUsd: cost.usd,
    report,
  };
}
