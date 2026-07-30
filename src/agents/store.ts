/**
 * Writing agent JSON files back from the Agent Builder UI, and per-workspace
 * agent overrides.
 *
 * Every path is derived from a validated id — an agent id must match
 * /^[a-z][a-z0-9_]*$/ and a workspace id its own pattern — so an id from an
 * HTTP request can never escape the agents directory.
 */
import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../audit";
import { isValidWorkspaceId } from "../workspace";
import { reloadRegistry } from "./registry";
import { AgentConfig, agentSchema } from "./schema";

const AGENTS_DIR = path.resolve(process.cwd(), "agents");
const WORKSPACES_DIR = path.join(AGENTS_DIR, "workspaces");
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export class AgentWriteError extends Error {}

function assertSafeAgentId(id: string): void {
  if (!AGENT_ID_PATTERN.test(id) || id.length > 48) {
    throw new AgentWriteError(
      `invalid agent id "${id}" — must be snake_case, starting with a letter (max 48 chars)`
    );
  }
}

function agentPath(agentId: string, workspaceId?: string): string {
  assertSafeAgentId(agentId);
  if (workspaceId === undefined) return path.join(AGENTS_DIR, `${agentId}.json`);
  if (!isValidWorkspaceId(workspaceId)) {
    throw new AgentWriteError(`invalid workspace id "${workspaceId}"`);
  }
  return path.join(WORKSPACES_DIR, workspaceId, `${agentId}.json`);
}

/** Read a workspace's override for an agent, if any. */
export function readOverride(workspaceId: string, agentId: string): Partial<AgentConfig> | null {
  let file: string;
  try {
    file = agentPath(agentId, workspaceId);
  } catch {
    return null;
  }
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AgentConfig>;
  } catch (err) {
    console.error(
      `workspace override ${workspaceId}/${agentId}.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

export function listOverrides(workspaceId: string): string[] {
  if (!isValidWorkspaceId(workspaceId)) return [];
  const dir = path.join(WORKSPACES_DIR, workspaceId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

/**
 * Write an agent config. With no workspaceId this edits the shared roster;
 * with one it writes an override for that workspace only.
 */
export function writeAgent(
  config: unknown,
  opts: { workspaceId?: string; expectId?: string } = {}
): AgentConfig {
  const parsed = agentSchema.safeParse(config);
  if (!parsed.success) {
    throw new AgentWriteError(`agent config is invalid: ${parsed.error.message}`);
  }
  const agent = parsed.data;
  if (opts.expectId !== undefined && agent.id !== opts.expectId) {
    throw new AgentWriteError(
      `agent id "${agent.id}" does not match the id being edited ("${opts.expectId}")`
    );
  }

  const file = agentPath(agent.id, opts.workspaceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(agent, null, 2)}\n`, "utf8");

  logEvent({
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    agentId: agent.id,
    eventType: opts.workspaceId === undefined ? "agent_config_saved" : "agent_override_saved",
    detail: { agentId: agent.id, model: agent.model, tools: agent.tools },
  });
  reloadRegistry();
  return agent;
}

export function deleteAgent(agentId: string, workspaceId?: string): boolean {
  const file = agentPath(agentId, workspaceId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  logEvent({
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    agentId,
    eventType: workspaceId === undefined ? "agent_config_deleted" : "agent_override_deleted",
    detail: { agentId },
  });
  reloadRegistry();
  return true;
}
