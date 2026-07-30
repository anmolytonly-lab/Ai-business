/**
 * Phase 3 orchestration: the CEO agent decomposes an owner goal into a task
 * DAG. The plan is zod-validated, semantically checked (known agents, valid
 * dependencies, no cycles, task cap) with one corrective retry, then
 * persisted to the tasks table.
 */
import { z } from "zod";
import { getAgent, listAgents } from "../agents/registry";
import { logEvent } from "../audit";
import { getDb } from "../db";
import { generateJson } from "../llm/provider";

/** Hard caps from the spec: stop and report rather than run away. */
export const MAX_TASKS_PER_GOAL = 40;
export const MAX_DELEGATION_ROUNDS = 5;

const plannedTaskSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  instruction: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.string().min(1),
});
const planSchema = z.object({ tasks: z.array(plannedTaskSchema).min(1) });

export type Plan = z.infer<typeof planSchema>;
export type PlannedTask = z.infer<typeof plannedTaskSchema>;

export interface GoalRow {
  id: string;
  workspace_id: string;
  description: string;
  status: string;
  report: string | null;
  delegation_round: number;
  created_at: string;
  completed_at: string | null;
}

/** Thrown when a hard cap stops orchestration — the caller reports and stops. */
export class CapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapExceededError";
  }
}

function validatePlan(plan: Plan, existingTaskCount: number): string[] {
  const errors: string[] = [];
  const total = plan.tasks.length + existingTaskCount;
  if (total > MAX_TASKS_PER_GOAL) {
    errors.push(
      `plan would bring this goal to ${total} tasks; hard cap is ${MAX_TASKS_PER_GOAL}`
    );
  }
  const ids = new Set<string>();
  for (const t of plan.tasks) {
    if (ids.has(t.id)) errors.push(`duplicate task id "${t.id}"`);
    ids.add(t.id);
    if (t.agentId === "ceo") errors.push(`task "${t.id}": the CEO never executes tasks`);
    else if (getAgent(t.agentId) === undefined) {
      errors.push(`task "${t.id}": unknown agentId "${t.agentId}"`);
    }
  }
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn) {
      if (dep === t.id) errors.push(`task "${t.id}" depends on itself`);
      else if (!ids.has(dep)) errors.push(`task "${t.id}": unknown dependency "${dep}"`);
    }
  }
  // Cycle detection via DFS colouring.
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const visit = (id: string, stack: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      errors.push(`dependency cycle involving "${id}" (${stack.join(" -> ")})`);
      return;
    }
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep, [...stack, dep]);
    }
    state.set(id, "done");
  };
  for (const t of plan.tasks) visit(t.id, [t.id]);
  return errors;
}

function buildPlanningPrompt(goal: string): string {
  const roster = listAgents()
    .filter((a) => a.id !== "ceo")
    .map((a) => `- ${a.id} (${a.department}): ${a.role}`)
    .join("\n");
  return `The owner has set this goal for the company:
"${goal}"

Decompose it into a task plan for your team. Company roster (agentId (department): role):
${roster}

Rules:
- Use 3-10 tasks unless the goal genuinely needs more. Hard cap: ${MAX_TASKS_PER_GOAL}.
- Each task: "id" (short, like "t1"), "agentId" (must be from the roster above),
  "instruction" (specific and self-contained — the agent sees ONLY this text plus
  outputs of its dependencies), "dependsOn" (array of task ids whose output this
  task needs), "acceptanceCriteria" (a concretely checkable bar for the deliverable).
- Prefer parallel work: only add a dependency when the task truly needs that output.
- No dependency cycles. Do not assign work to yourself.

Return: {"tasks": [{"id": string, "agentId": string, "instruction": string, "dependsOn": string[], "acceptanceCriteria": string}]}`;
}

async function requestPlan(goal: GoalRow, correction?: string): Promise<Plan> {
  const ceo = getAgent("ceo");
  if (ceo === undefined) throw new Error("ceo agent missing from registry — cannot plan");
  const prompt =
    buildPlanningPrompt(goal.description) +
    (correction !== undefined
      ? `\n\nYour previous plan was rejected for these reasons — fix ALL of them:\n${correction}`
      : "");
  const { data } = await generateJson(prompt, planSchema, {
    agentId: ceo.id,
    workspaceId: goal.workspace_id,
    model: ceo.model,
    temperature: ceo.temperature,
    systemPrompt: ceo.systemPrompt,
    purpose: correction === undefined ? "plan-goal" : "plan-goal-corrected",
  });
  return data;
}

/** Plan a goal and persist its task DAG. Returns the stored task ids. */
export async function planGoal(goalId: string): Promise<string[]> {
  const db = getDb();
  const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as
    | GoalRow
    | undefined;
  if (goal === undefined) throw new Error(`unknown goal "${goalId}"`);

  // Hard cap: stop and report rather than delegate forever.
  const round = goal.delegation_round + 1;
  if (round > MAX_DELEGATION_ROUNDS) {
    const message = `goal ${goalId} hit the ${MAX_DELEGATION_ROUNDS}-delegation-round cap — stopping and reporting`;
    db.prepare("UPDATE goals SET status = 'failed', report = ? WHERE id = ?").run(message, goalId);
    logEvent({
      workspaceId: goal.workspace_id,
      eventType: "delegation_cap_reached",
      detail: { goalId, round, cap: MAX_DELEGATION_ROUNDS },
    });
    throw new CapExceededError(message);
  }

  const existingTaskCount = (
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE goal_id = ?").get(goalId) as { n: number }
  ).n;
  if (existingTaskCount >= MAX_TASKS_PER_GOAL) {
    const message = `goal ${goalId} already has ${existingTaskCount} tasks (cap ${MAX_TASKS_PER_GOAL}) — stopping and reporting`;
    db.prepare("UPDATE goals SET status = 'failed', report = ? WHERE id = ?").run(message, goalId);
    logEvent({
      workspaceId: goal.workspace_id,
      eventType: "task_cap_reached",
      detail: { goalId, existingTaskCount, cap: MAX_TASKS_PER_GOAL },
    });
    throw new CapExceededError(message);
  }

  db.prepare("UPDATE goals SET status = 'planning', delegation_round = ? WHERE id = ?").run(
    round,
    goalId
  );

  let plan = await requestPlan(goal);
  let errors = validatePlan(plan, existingTaskCount);
  if (errors.length > 0) {
    console.warn(`plan rejected (${errors.length} problems), asking CEO to correct`);
    plan = await requestPlan(goal, errors.map((e) => `- ${e}`).join("\n"));
    errors = validatePlan(plan, existingTaskCount);
    if (errors.length > 0) {
      db.prepare("UPDATE goals SET status = 'failed', report = ? WHERE id = ?").run(
        `Planning failed after correction: ${errors.join("; ")}`,
        goalId
      );
      logEvent({
        workspaceId: goal.workspace_id,
        agentId: "ceo",
        eventType: "goal_planning_failed",
        detail: { goalId, errors },
      });
      throw new Error(`CEO plan invalid after retry: ${errors.join("; ")}`);
    }
  }

  // Map the CEO's local ids (t1, t2...) to globally unique task ids. The round
  // is part of the id so a later delegation round can't collide with this one.
  const prefix = `${goalId.slice(0, 8)}${round > 1 ? `r${round}` : ""}`;
  const globalId = (local: string): string => `${prefix}-${local}`;

  const insert = db.prepare(
    `INSERT INTO tasks (id, goal_id, workspace_id, agent_id, instruction,
                        acceptance_criteria, depends_on, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  );
  const insertAll = db.transaction(() => {
    for (const t of plan.tasks) {
      insert.run(
        globalId(t.id),
        goalId,
        goal.workspace_id,
        t.agentId,
        t.instruction,
        t.acceptanceCriteria,
        JSON.stringify(t.dependsOn.map(globalId))
      );
    }
  });
  insertAll();

  logEvent({
    workspaceId: goal.workspace_id,
    agentId: "ceo",
    eventType: "goal_planned",
    detail: {
      goalId,
      round,
      taskCount: plan.tasks.length,
      tasks: plan.tasks.map((t) => ({ id: globalId(t.id), agentId: t.agentId, dependsOn: t.dependsOn.map(globalId) })),
    },
  });

  return plan.tasks.map((t) => globalId(t.id));
}
