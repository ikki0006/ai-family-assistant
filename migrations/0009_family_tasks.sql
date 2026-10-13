CREATE TABLE family_task_state (
 group_id TEXT PRIMARY KEY,
 version INTEGER NOT NULL DEFAULT 0,
 tasks_json TEXT NOT NULL DEFAULT '[]',
 last_event TEXT NOT NULL DEFAULT ''
);
CREATE TABLE family_task_events (
 group_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 PRIMARY KEY(group_id,event_id)
);
