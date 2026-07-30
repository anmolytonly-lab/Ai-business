import crypto from "node:crypto";
import { logEvent } from "../audit";
import { getDb } from "../db";
import { GoalRow, planGoal } from "./planner";
import { GoalReport, runGoal, TaskRow } from "./runner";

export function createGoal(workspaceId: string, description: string): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare("INSERT INTO goals (id, workspace_id, description) VALUES (?, ?, ?)")
    .run(id, workspaceId, description);
  logEvent({ workspaceId, eventType: "goal_created", detail: { goalId: id, description } });
  return id;
}

/** Plan then execute a goal end-to-end. */
export async function executeGoal(goalId: string): Promise<GoalReport> {
  await planGoal(goalId);
  return runGoal(goalId);
}

export function getGoal(goalId: string): (GoalRow & { tasks: TaskRow[] }) | undefined {
  const db = getDb();
  const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as
    | GoalRow
    | undefined;
  if (goal === undefined) return undefined;
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at")
    .all(goalId) as TaskRow[];
  return { ...goal, tasks };
}

export function listGoals(workspaceId: string): GoalRow[] {
  return getDb()
    .prepare("SELECT * FROM goals WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as GoalRow[];
}
