CREATE TABLE improvements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  specification TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatching', 'dispatched', 'uncertain')),
  UNIQUE(group_id, event_id)
);
