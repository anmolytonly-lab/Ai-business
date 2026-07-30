-- Phase 10: each workspace is a separate business/client with its own budget.
-- Knowledge base, goals, tasks, approvals and memory are already scoped by
-- workspace_id; this adds the per-workspace settings.
ALTER TABLE workspaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN daily_budget_usd REAL;
ALTER TABLE workspaces ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
