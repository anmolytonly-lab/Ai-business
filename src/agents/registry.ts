/**
 * Agent registry: agents live as JSON files in /agents — never hardcoded.
 * Files are validated with zod on load and hot-reloaded on change. A file
 * that fails validation keeps the previous good version in memory.
 */
import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../audit";
import { AgentConfig, agentSchema } from "./schema";

const AGENTS_DIR = path.resolve(process.cwd(), "agents");
const agents = new Map<string, AgentConfig>();
let watcher: fs.FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

function loadFile(file: string): AgentConfig | null {
  const full = path.join(AGENTS_DIR, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    console.error(`agent file ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const result = agentSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`agent file ${file} failed validation: ${result.error.message}`);
    return null;
  }
  const idFromFile = path.basename(file, ".json");
  if (result.data.id !== idFromFile) {
    console.error(`agent file ${file}: id "${result.data.id}" must match filename`);
    return null;
  }
  return result.data;
}

function loadAll(reason: "startup" | "reload"): void {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.warn(`agents directory not found at ${AGENTS_DIR}`);
    return;
  }
  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".json")).sort();
  const seen = new Set<string>();
  let loaded = 0;
  let failed = 0;

  for (const file of files) {
    const agent = loadFile(file);
    if (agent === null) {
      failed++;
      continue; // keep any previous good version in memory
    }
    agents.set(agent.id, agent);
    seen.add(agent.id);
    loaded++;
  }

  // Drop agents whose file was deleted (only on full reloads).
  for (const id of [...agents.keys()]) {
    if (!seen.has(id) && files.includes(`${id}.json`) === false) agents.delete(id);
  }

  // Cross-reference warnings — non-fatal, but never silent.
  for (const agent of agents.values()) {
    const refs = [agent.reportsTo, ...agent.canDelegateTo];
    for (const ref of refs) {
      if (ref !== "owner" && !agents.has(ref)) {
        console.warn(`agent ${agent.id}: references unknown agent "${ref}"`);
      }
    }
  }

  console.log(`agent registry ${reason}: ${loaded} loaded, ${failed} failed, ${agents.size} active`);
  if (reason === "reload") {
    logEvent({ eventType: "registry_reloaded", detail: { loaded, failed, active: agents.size } });
  }
}

export function initRegistry(): void {
  loadAll("startup");
  if (watcher) return;
  try {
    watcher = fs.watch(AGENTS_DIR, () => {
      // Debounce editor write bursts into a single reload.
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => loadAll("reload"), 300).unref();
    });
    // Don't hold the event loop open: the server stays alive on its socket,
    // and one-shot scripts can exit when their work is done.
    watcher.unref();
  } catch (err) {
    console.warn(`agents hot-reload watcher unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getAgent(id: string): AgentConfig | undefined {
  return agents.get(id);
}

export function listAgents(): AgentConfig[] {
  return [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));
}
