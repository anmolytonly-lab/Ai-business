-- Phase 9: scheduled routine runs, so autonomous activity is as auditable as
-- everything else and a restart does not re-fire jobs that already ran.
CREATE TABLE routine_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  trigger      TEXT NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
  goal_id      TEXT REFERENCES goals(id),
  summary      TEXT,
  error        TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at  TEXT
);
CREATE INDEX idx_routine_runs ON routine_runs(routine_id, started_at);
