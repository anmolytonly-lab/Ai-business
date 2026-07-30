-- Phase 6: Company Brain. Documents are chunked; each chunk is embedded and
-- indexed in a sqlite-vec virtual table for similarity search.

CREATE TABLE document_chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_workspace ON document_chunks(workspace_id);

-- Vector index. rowid matches document_chunks.id so results join straight back.
CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[768]);
