CREATE TABLE IF NOT EXISTS long_term_memories (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  text TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(group_id, subject, fact_key)
);
CREATE INDEX IF NOT EXISTS long_term_memories_group ON long_term_memories(group_id, expires_at);
