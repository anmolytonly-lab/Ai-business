/**
 * Two-layer memory (spec item 9).
 *  - Episodic: what an agent did and how it went, written after each task.
 *  - Semantic: the Company Brain (src/brain), shared across agents.
 * Episodes are compacted into summaries on a schedule so an agent's history
 * never grows without bound.
 */
import { getAgent } from "./agents/registry";
import { logEvent } from "./audit";
import { getDb } from "./db";
import { generateText } from "./llm/provider";

/** Episodes kept per agent before compaction kicks in. */
const COMPACT_THRESHOLD = 20;
/** How many of the most recent episodes stay verbatim after compaction. */
const KEEP_RECENT = 5;

export interface MemoryRow {
  id: number;
  agent_id: string;
  kind: string;
  content: string;
  created_at: string;
}

export function recordEpisode(
  workspaceId: string,
  agentId: string,
  content: string
): void {
  getDb()
    .prepare(
      "INSERT INTO agent_memory (workspace_id, agent_id, kind, content) VALUES (?, ?, 'episode', ?)"
    )
    .run(workspaceId, agentId, content.slice(0, 2000));
}

/** Recent memory for an agent: summaries first, then recent episodes. */
export function recallForAgent(workspaceId: string, agentId: string, limit = 6): string {
  const rows = getDb()
    .prepare(
      `SELECT kind, content, created_at FROM agent_memory
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY (kind = 'summary') DESC, created_at DESC LIMIT ?`
    )
    .all(workspaceId, agentId, limit) as MemoryRow[];
  if (rows.length === 0) return "";
  return (
    "YOUR MEMORY — what you have done before and what worked:\n" +
    rows.map((r) => `- ${r.content}`).join("\n")
  );
}

/**
 * Compact one agent's episodes into a summary, keeping the most recent few
 * verbatim. Returns the number of episodes folded away.
 */
export async function compactAgentMemory(
  workspaceId: string,
  agentId: string
): Promise<number> {
  const db = getDb();
  const episodes = db
    .prepare(
      `SELECT id, content, created_at FROM agent_memory
        WHERE workspace_id = ? AND agent_id = ? AND kind = 'episode'
        ORDER BY created_at ASC`
    )
    .all(workspaceId, agentId) as MemoryRow[];

  if (episodes.length <= COMPACT_THRESHOLD) return 0;

  const toCompact = episodes.slice(0, episodes.length - KEEP_RECENT);
  const priorSummary = db
    .prepare(
      `SELECT content FROM agent_memory
        WHERE workspace_id = ? AND agent_id = ? AND kind = 'summary'
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(workspaceId, agentId) as { content: string } | undefined;

  const agent = getAgent(agentId);
  const prompt = `You are compacting the working memory of the "${agentId}" agent${
    agent === undefined ? "" : ` (${agent.role})`
  }.

${priorSummary === undefined ? "" : `EXISTING SUMMARY:\n${priorSummary.content}\n\n`}EPISODES TO FOLD IN (oldest first):
${toCompact.map((e) => `- ${e.content}`).join("\n")}

Write a single replacement summary under 200 words capturing only what is
durably useful for future work: what this agent repeatedly does, what worked,
what was rejected in review and why, and any standing constraints it learned.
Drop one-off detail. Output only the summary.`;

  const result = await generateText(prompt, {
    workspaceId,
    agentId,
    purpose: "memory-compaction",
    temperature: 0.3,
  });

  const compact = db.transaction(() => {
    for (const e of toCompact) db.prepare("DELETE FROM agent_memory WHERE id = ?").run(e.id);
    if (priorSummary !== undefined) {
      db.prepare(
        "DELETE FROM agent_memory WHERE workspace_id = ? AND agent_id = ? AND kind = 'summary'"
      ).run(workspaceId, agentId);
    }
    db.prepare(
      "INSERT INTO agent_memory (workspace_id, agent_id, kind, content) VALUES (?, ?, 'summary', ?)"
    ).run(workspaceId, agentId, result.text.trim());
  });
  compact();

  logEvent({
    workspaceId,
    agentId,
    eventType: "memory_compacted",
    detail: { foldedEpisodes: toCompact.length, keptRecent: KEEP_RECENT },
  });
  return toCompact.length;
}

/** Compact every agent whose episode count is over the threshold. */
export async function compactAllMemories(workspaceId: string): Promise<number> {
  const agents = getDb()
    .prepare(
      `SELECT agent_id, COUNT(*) AS n FROM agent_memory
        WHERE workspace_id = ? AND kind = 'episode'
        GROUP BY agent_id HAVING n > ?`
    )
    .all(workspaceId, COMPACT_THRESHOLD) as { agent_id: string; n: number }[];

  let total = 0;
  for (const row of agents) {
    total += await compactAgentMemory(workspaceId, row.agent_id);
  }
  return total;
}

export function listMemory(workspaceId: string, agentId?: string): MemoryRow[] {
  const db = getDb();
  if (agentId !== undefined) {
    return db
      .prepare(
        "SELECT * FROM agent_memory WHERE workspace_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 100"
      )
      .all(workspaceId, agentId) as MemoryRow[];
  }
  return db
    .prepare("SELECT * FROM agent_memory WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(workspaceId) as MemoryRow[];
}
