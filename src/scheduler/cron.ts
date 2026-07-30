/**
 * Minimal 5-field cron parser and in-process scheduler.
 * Hand-rolled to avoid a dependency: supports `*`, numbers, `a-b` ranges,
 * `a,b` lists and `*` / `a-b` with `/n` steps — which covers every schedule
 * the autonomous routines need.
 *
 * Fields: minute hour day-of-month month day-of-week (0 = Sunday)
 */

export class CronParseError extends Error {}

interface Field {
  min: number;
  max: number;
  values: Set<number>;
}

function parseField(spec: string, min: number, max: number, label: string): Field {
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(`invalid step "${stepPart}" in ${label} field`);
    }

    let from: number;
    let to: number;
    if (rangePart === "*" || rangePart === undefined) {
      from = min;
      to = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      from = Number(a);
      to = Number(b);
    } else {
      from = Number(rangePart);
      to = stepPart === undefined ? from : max;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new CronParseError(`invalid ${label} value "${part}" (expected ${min}-${max})`);
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { min, max, values };
}

export interface CronSchedule {
  expression: string;
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
}

export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      `cron expression must have 5 fields (minute hour day month weekday), got ${parts.length}: "${expression}"`
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    expression,
    minute: parseField(minute, 0, 59, "minute"),
    hour: parseField(hour, 0, 23, "hour"),
    dayOfMonth: parseField(dayOfMonth, 1, 31, "day-of-month"),
    month: parseField(month, 1, 12, "month"),
    dayOfWeek: parseField(dayOfWeek, 0, 6, "day-of-week"),
  };
}

/**
 * Standard cron semantics: when both day-of-month and day-of-week are
 * restricted, the job runs if EITHER matches.
 */
export function matches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minute.values.has(date.getMinutes())) return false;
  if (!schedule.hour.values.has(date.getHours())) return false;
  if (!schedule.month.values.has(date.getMonth() + 1)) return false;

  const domRestricted = schedule.dayOfMonth.values.size < 31;
  const dowRestricted = schedule.dayOfWeek.values.size < 7;
  const domMatch = schedule.dayOfMonth.values.has(date.getDate());
  const dowMatch = schedule.dayOfWeek.values.has(date.getDay());

  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  if (domRestricted) return domMatch;
  if (dowRestricted) return dowMatch;
  return true;
}

/** Next fire time after `from`, or null if none within a year. */
export function nextRun(schedule: CronSchedule, from: Date = new Date()): Date | null {
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    if (matches(schedule, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
