-- Phase 5: every deliverable is reviewed against its acceptance criteria.
-- One row per review round so the full critique history is auditable.
CREATE TABLE reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
  reviewer_id    TEXT NOT NULL,
  producer_id    TEXT NOT NULL,
  round          INTEGER NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('APPROVE', 'REVISE')),
  feedback       TEXT NOT NULL,
  required_changes TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  deliverable    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_reviews_task ON reviews(task_id);

-- Work the agents could not get past review, waiting on a human decision.
CREATE TABLE escalations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  goal_id      TEXT REFERENCES goals(id),
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  producer_id  TEXT NOT NULL,
  reviewer_id  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  deliverable  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at  TEXT
);
CREATE INDEX idx_escalations_open ON escalations(workspace_id, status);
