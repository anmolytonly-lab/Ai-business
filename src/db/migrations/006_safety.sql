-- Phase 7: kill switch state, and richer approval cards.

CREATE TABLE system_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO system_state (key, value) VALUES ('kill_switch', 'off');

-- Outcome of the legal_compliance pass that runs before an approval card is
-- created, plus the human's note when they decide.
ALTER TABLE approvals ADD COLUMN legal_flags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE approvals ADD COLUMN legal_assessment TEXT;
ALTER TABLE approvals ADD COLUMN decision_note TEXT;
