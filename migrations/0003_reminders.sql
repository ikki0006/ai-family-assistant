CREATE TABLE reminders (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL,
 title TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('once','daily','weekly')),
 anchor_at INTEGER NOT NULL,
 next_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','paused','done','deleted')),
 version INTEGER NOT NULL DEFAULT 1,
 last_event TEXT NOT NULL
);
CREATE INDEX reminders_due ON reminders(group_id,status,next_at);
CREATE TABLE line_reminder_deliveries (
 delivery_key TEXT PRIMARY KEY,
 sent_at INTEGER NOT NULL
);
