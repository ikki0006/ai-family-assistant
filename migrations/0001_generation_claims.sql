-- Operational IDs only; never store prompts, answers, group IDs, or credentials.
CREATE TABLE generation_claims (
  event_id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX generation_claims_created_at ON generation_claims(created_at);
