/**
 * Brand & handbook injection: one company_handbook.md whose brand voice, tone
 * rules and forbidden claims are prepended to every agent's system prompt.
 * Hot-reloaded like the agent registry so edits take effect without a restart.
 */
import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../audit";

const HANDBOOK_PATH = path.resolve(process.cwd(), "company_handbook.md");

let handbook = "";
let watcher: fs.FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

function load(reason: "startup" | "reload"): void {
  if (!fs.existsSync(HANDBOOK_PATH)) {
    handbook = "";
    console.warn(
      `company_handbook.md not found at ${HANDBOOK_PATH} — agents will run without brand rules`
    );
    return;
  }
  handbook = fs.readFileSync(HANDBOOK_PATH, "utf8").trim();
  console.log(`company handbook ${reason}: ${handbook.length} characters`);
  if (reason === "reload") {
    logEvent({ eventType: "handbook_reloaded", detail: { chars: handbook.length } });
  }
}

export function initHandbook(): void {
  load("startup");
  if (watcher) return;
  try {
    // Watch the containing directory, not the file. fs.watch on a single file
    // binds to its inode, so an editor that saves by writing a temp file and
    // renaming it over the original leaves the watcher attached to a file that
    // no longer exists — reloads silently stop after the first save.
    const dir = path.dirname(HANDBOOK_PATH);
    const filename = path.basename(HANDBOOK_PATH);
    watcher = fs.watch(dir, (_event, changed) => {
      if (changed !== null && changed !== filename) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => load("reload"), 300).unref();
    });
    watcher.unref();
  } catch (err) {
    console.warn(
      `handbook hot-reload unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function getHandbook(): string {
  return handbook;
}

/**
 * Build the full system prompt for an agent: company handbook first (it
 * constrains everything), then the agent's own role prompt.
 */
export function withHandbook(agentSystemPrompt: string): string {
  if (handbook === "") return agentSystemPrompt;
  return (
    `=== COMPANY HANDBOOK (binding on every response) ===\n${handbook}\n` +
    `=== END COMPANY HANDBOOK ===\n\n` +
    `Follow the handbook above at all times. If your role instructions below ` +
    `ever conflict with it, the handbook wins.\n\n${agentSystemPrompt}`
  );
}
