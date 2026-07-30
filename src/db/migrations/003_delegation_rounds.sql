-- Phase 3: count delegation rounds per goal so the 5-round hard cap is
-- enforceable. Round 1 is the CEO's initial plan; later phases increment this
-- when an agent's work expands the DAG.
ALTER TABLE goals ADD COLUMN delegation_round INTEGER NOT NULL DEFAULT 0;
