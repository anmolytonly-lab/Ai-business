/**
 * Global kill switch. When engaged, every LLM call and every tool call is
 * refused immediately, so all agents halt wherever they are.
 */
import { logEvent } from "../audit";
import { getDb } from "../db";

export class KillSwitchError extends Error {
  constructor() {
    super("KILL SWITCH ENGAGED — all agent activity is halted. Disengage it to resume.");
    this.name = "KillSwitchError";
  }
}

export function isKillSwitchOn(): boolean {
  const row = getDb()
    .prepare("SELECT value FROM system_state WHERE key = 'kill_switch'")
    .get() as { value: string } | undefined;
  return row?.value === "on";
}

export function setKillSwitch(on: boolean, reason = ""): void {
  getDb()
    .prepare(
      `INSERT INTO system_state (key, value, updated_at)
       VALUES ('kill_switch', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(on ? "on" : "off");
  logEvent({
    eventType: on ? "kill_switch_engaged" : "kill_switch_released",
    detail: { reason },
  });
  console.warn(on ? `KILL SWITCH ENGAGED ${reason}` : "kill switch released — agents may run again");
}

/** Throws if the kill switch is on. Called before every model and tool call. */
export function assertNotKilled(): void {
  if (isKillSwitchOn()) throw new KillSwitchError();
}
