/**
 * Company Brain: a vector-backed knowledge base of business context.
 * Owner documents and agent learnings are chunked, embedded and indexed with
 * sqlite-vec so every agent can retrieve relevant context before answering.
 */
import crypto from "node:crypto";
import { logEvent } from "../audit";
import { env } from "../config/env";
import { getDb, isVecAvailable } from "../db";
import { embedText } from "../llm/provider";
import { chunkText } from "./chunker";

export interface BrainHit {
  chunkId: number;
  documentId: string;
  title: string;
  source: string;
  needsReview: boolean;
  content: string;
  /** 0..1, higher is more similar. */
  score: number;
}

export interface DocumentRow {
  id: string;
  workspace_id: string;
  title: string;
  source: string;
  content: string;
  needs_review: number;
  created_at: string;
}

/** sqlite-vec accepts a JSON array as the vector literal. */
const toVector = (values: number[]): string => JSON.stringify(values);

/**
 * Add a document and index it. `source: "agent"` marks a learning written back
 * by an agent — always flagged for human review.
 */
export async function addDocument(opts: {
  workspaceId: string;
  title: string;
  content: string;
  source?: "owner" | "agent";
  agentId?: string;
}): Promise<{ documentId: string; chunks: number }> {
  const { workspaceId, title } = opts;
  const content = opts.content.trim();
  if (title.trim() === "") throw new Error("document title must not be empty");
  if (content === "") throw new Error("document content must not be empty");
  if (!isVecAvailable()) {
    throw new Error("sqlite-vec is not loaded — the Company Brain cannot index documents");
  }

  const source = opts.source ?? "owner";
  const needsReview = source === "agent" ? 1 : 0;
  const documentId = crypto.randomUUID();
  const db = getDb();

  // Embed first (network I/O, can fail), then write document, chunks and
  // vectors in one transaction — a failure must never leave an unindexed
  // document that agents would silently retrieve nothing from.
  const chunks = chunkText(content);
  const embedded: { index: number; text: string; vector: number[] }[] = [];
  for (const [index, text] of chunks.entries()) {
    embedded.push({ index, text, vector: await embedText(text, "RETRIEVAL_DOCUMENT") });
  }

  const insertChunk = db.prepare(
    `INSERT INTO document_chunks (document_id, workspace_id, chunk_index, content)
     VALUES (?, ?, ?, ?)`
  );
  const insertVec = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO documents (id, workspace_id, title, source, content, needs_review)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(documentId, workspaceId, title.trim(), source, content, needsReview);
    for (const item of embedded) {
      const info = insertChunk.run(documentId, workspaceId, item.index, item.text);
      // vec0 only accepts a BigInt for the rowid — a JS number is rejected
      // with "Only integers are allows for primary key values".
      insertVec.run(BigInt(info.lastInsertRowid), toVector(item.vector));
    }
  });
  write();

  logEvent({
    workspaceId,
    ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
    eventType: source === "agent" ? "brain_learning_written" : "brain_document_added",
    detail: { documentId, title, chunks: embedded.length, needsReview: needsReview === 1 },
  });

  return { documentId, chunks: embedded.length };
}

/** Semantic search over the workspace's knowledge base. */
export async function search(
  workspaceId: string,
  query: string,
  topK: number = env.BRAIN_TOP_K
): Promise<BrainHit[]> {
  if (!isVecAvailable() || query.trim() === "") return [];
  const db = getDb();

  const total = db
    .prepare("SELECT COUNT(*) AS n FROM document_chunks WHERE workspace_id = ?")
    .get(workspaceId) as { n: number };
  if (total.n === 0) return [];

  const vector = toVector(await embedText(query, "RETRIEVAL_QUERY"));

  // Over-fetch, then filter by workspace: vec0 MATCH needs its own LIMIT and
  // can't join to the workspace column inside the KNN query.
  const candidates = db
    .prepare(
      `SELECT rowid AS chunk_id, distance
         FROM vec_chunks
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance`
    )
    .all(vector, Math.max(topK * 4, 20)) as { chunk_id: number; distance: number }[];
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.chunk_id);
  const rows = db
    .prepare(
      `SELECT c.id, c.content, c.document_id, d.title, d.source, d.needs_review
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE c.id IN (${ids.map(() => "?").join(",")}) AND c.workspace_id = ?`
    )
    .all(...ids, workspaceId) as {
    id: number;
    content: string;
    document_id: string;
    title: string;
    source: string;
    needs_review: number;
  }[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const hits: BrainHit[] = [];
  for (const candidate of candidates) {
    const row = byId.get(candidate.chunk_id);
    if (row === undefined) continue; // different workspace
    hits.push({
      chunkId: row.id,
      documentId: row.document_id,
      title: row.title,
      source: row.source,
      needsReview: row.needs_review === 1,
      content: row.content,
      // vec0 returns L2 distance on normalised vectors; map to a 0..1 score.
      score: Math.max(0, 1 - candidate.distance / 2),
    });
    if (hits.length >= topK) break;
  }
  return hits;
}

/** Retrieved context block prepended to an agent's prompt. */
export function formatContext(hits: BrainHit[]): string {
  if (hits.length === 0) return "";
  const blocks = hits.map(
    (h, i) =>
      `[${i + 1}] ${h.title}${h.needsReview ? " (UNREVIEWED agent learning — treat with caution)" : ""}\n${h.content}`
  );
  return (
    `COMPANY KNOWLEDGE BASE — context retrieved for this task.\n` +
    `Use it as the source of truth about this business. If it does not contain ` +
    `what you need, say so rather than inventing details.\n\n${blocks.join("\n\n")}`
  );
}

export function listDocuments(workspaceId: string): Omit<DocumentRow, "content">[] {
  return getDb()
    .prepare(
      `SELECT d.id, d.workspace_id, d.title, d.source, d.needs_review, d.created_at,
              (SELECT COUNT(*) FROM document_chunks c WHERE c.document_id = d.id) AS chunks
         FROM documents d WHERE d.workspace_id = ? ORDER BY d.created_at DESC`
    )
    .all(workspaceId) as Omit<DocumentRow, "content">[];
}

export function getDocument(id: string): DocumentRow | undefined {
  return getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | DocumentRow
    | undefined;
}

/** Approve an agent-written learning so it stops being flagged. */
export function approveDocument(id: string): boolean {
  const info = getDb()
    .prepare("UPDATE documents SET needs_review = 0 WHERE id = ? AND needs_review = 1")
    .run(id);
  if (info.changes > 0) logEvent({ eventType: "brain_learning_approved", detail: { documentId: id } });
  return info.changes > 0;
}

export function deleteDocument(id: string): boolean {
  const db = getDb();
  const chunkIds = db
    .prepare("SELECT id FROM document_chunks WHERE document_id = ?")
    .all(id) as { id: number }[];
  const remove = db.transaction(() => {
    for (const c of chunkIds) {
      db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(c.id));
    }
    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(id);
    return db.prepare("DELETE FROM documents WHERE id = ?").run(id).changes;
  });
  const changes = remove();
  if (changes > 0) logEvent({ eventType: "brain_document_deleted", detail: { documentId: id } });
  return changes > 0;
}
