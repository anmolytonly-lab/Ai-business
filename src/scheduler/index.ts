/**
 * The scheduler ticks once a minute and fires any routine whose cron matches.
 * Routines are skipped (not queued) while the kill switch is engaged, and a
 * routine already running is never started twice.
 */
import { logEvent } from "../audit";
import { env } from "../config/env";
import { getDb } from "../db";
import { isKillSwitchOn } from "../safety/killswitch";
import { CronSchedule, matches, nextRun, parseCron } from "./cron";
import { ROUTINES, Routine, getRoutine, runRoutine } from "./routines";

interface Registered {
  routine: Routine;
  schedule: CronSchedule;
}

const registered: Registered[] = [];
const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let lastTickMinute = "";

export interface RoutineRunRow {
  id: number;
  routine_id: string;
  status: string;
  trigger: string;
  goal_id: string | null;
  summary: string | null;
  error: string | null;
  cost_usd: number;
  started_at: string;
  finished_at: string | null;
}

function tick(workspaceId: string): void {
  const now = new Date();
  // Guard against double-firing if a tick lands twice in the same minute.
  const stamp = now.toISOString().slice(0, 16);
  if (stamp === lastTickMinute) return;
  lastTickMinute = stamp;

  for (const entry of registered) {
    if (!matches(entry.schedule, now)) continue;

    if (running.has(entry.routine.id)) {
      console.warn(`routine ${entry.routine.id} is still running; skipping this fire`);
      continue;
    }
    if (isKillSwitchOn()) {
      getDb()
        .prepare(
          `INSERT INTO routine_runs (routine_id, workspace_id, status, trigger, error, finished_at)
           VALUES (?, ?, 'skipped', 'schedule', 'kill switch engaged', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        )
        .run(entry.routine.id, workspaceId);
      logEvent({
        workspaceId,
        eventType: "routine_skipped",
        detail: { routineId: entry.routine.id, reason: "kill switch engaged" },
      });
      continue;
    }

    running.add(entry.routine.id);
    void runRoutine(entry.routine, { workspaceId, trigger: "schedule" }).finally(() => {
      running.delete(entry.routine.id);
    });
  }
}

export function startScheduler(workspaceId: string): void {
  if (timer !== null) return;

  registered.length = 0;
  for (const routine of ROUTINES) {
    try {
      registered.push({ routine, schedule: parseCron(routine.cron) });
    } catch (err) {
      console.error(
        `routine ${routine.id} has an invalid cron "${routine.cron}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (!env.SCHEDULER_ENABLED) {
    console.log(
      `scheduler disabled (SCHEDULER_ENABLED=false); ${registered.length} routines registered but idle`
    );
    return;
  }

  timer = setInterval(() => tick(workspaceId), 30_000);
  timer.unref();
  console.log(`scheduler started with ${registered.length} routines:`);
  for (const entry of registered) {
    const next = nextRun(entry.schedule);
    console.log(
      `  ${entry.routine.id.padEnd(20)} ${entry.routine.cron.padEnd(12)} next: ${
        next === null ? "never" : next.toISOString()
      }`
    );
  }
}

export function stopScheduler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function listRoutines(): {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun: RoutineRunRow | null;
}[] {
  const db = getDb();
  return ROUTINES.map((routine) => {
    let next: string | null = null;
    try {
      const parsed = parseCron(routine.cron);
      const d = nextRun(parsed);
      next = d === null ? null : d.toISOString();
    } catch {
      next = null;
    }
    const lastRun = db
      .prepare("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(routine.id) as RoutineRunRow | undefined;
    return {
      id: routine.id,
      name: routine.name,
      description: routine.description,
      cron: routine.cron,
      enabled: env.SCHEDULER_ENABLED,
      nextRun: next,
      lastRun: lastRun ?? null,
    };
  });
}

export function listRoutineRuns(limit = 30): RoutineRunRow[] {
  return getDb()
    .prepare("SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as RoutineRunRow[];
}

/** Fire a routine now, outside its schedule. */
export async function triggerRoutine(
  routineId: string,
  workspaceId: string
): Promise<{ runId: number; status: string; summary: string }> {
  const routine = getRoutine(routineId);
  if (routine === undefined) throw new Error(`unknown routine "${routineId}"`);
  if (running.has(routineId)) throw new Error(`routine "${routineId}" is already running`);
  running.add(routineId);
  try {
    return await runRoutine(routine, { workspaceId, trigger: "manual" });
  } finally {
    running.delete(routineId);
  }
}
