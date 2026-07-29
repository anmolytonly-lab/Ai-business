-- AgentCorp core schema (Phase 1).
-- Workspaces isolate businesses/clients; everything else hangs off one.

CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Owner goals handed to the CEO agent.
CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'planning', 'running', 'completed', 'failed', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

-- Task DAG produced by orchestration (Phase 3 fills this in).
CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  goal_id             TEXT NOT NULL REFERENCES goals(id),
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id),
  agent_id            TEXT NOT NULL,
  instruction         TEXT NOT NULL,
  acceptance_criteria TEXT,
  depends_on          TEXT NOT NULL DEFAULT '[]', -- JSON array of task ids
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'blocked', 'running', 'in_review',
                                        'revising', 'completed', 'failed', 'escalated')),
  result              TEXT,
  revision_round      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at        TEXT
);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_tasks_status ON tasks(workspace_id, status);

-- Every LLM call: tokens, cost, latency. Feeds the budget guard and audit log.
CREATE TABLE llm_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   TEXT REFERENCES workspaces(id),
  agent_id       TEXT,
  task_id        TEXT REFERENCES tasks(id),
  model          TEXT NOT NULL,
  purpose        TEXT,
  system_prompt  TEXT,
  request        TEXT NOT NULL,
  response       TEXT,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  latency_ms     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_llm_calls_day ON llm_calls(workspace_id, created_at);
CREATE INDEX idx_llm_calls_agent ON llm_calls(agent_id, created_at);

-- General audit trail: tool calls, approvals, deliveries, config changes.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT REFERENCES workspaces(id),
  agent_id     TEXT,
  task_id      TEXT,
  event_type   TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}', -- JSON payload
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_workspace ON audit_log(workspace_id, created_at);

-- Human approval queue (Phase 7 wires the workflow; schema exists now).
CREATE TABLE approvals (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id     TEXT NOT NULL,
  task_id      TEXT REFERENCES tasks(id),
  action_type  TEXT NOT NULL,             -- e.g. publish, send_email, spend, deploy
  payload      TEXT NOT NULL,             -- JSON: what would be executed
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_approvals_pending ON approvals(workspace_id, status);

-- Company Brain documents (Phase 6 adds chunking + embeddings via sqlite-vec).
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'agent')),
  content      TEXT NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0,  -- agent-written learnings flagged for review
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_documents_workspace ON documents(workspace_id);

-- Per-agent episodic memory (Phase 9 adds summarisation/compaction).
CREATE TABLE agent_memory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'episode' CHECK (kind IN ('episode', 'summary')),
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_memory_agent ON agent_memory(workspace_id, agent_id);
