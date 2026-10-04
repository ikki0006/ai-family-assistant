CREATE TABLE reminders_calendar (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL,
 title TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('once','daily','weekly','monthly','yearly')),
 anchor_at INTEGER NOT NULL,
 next_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','paused','done','deleted')),
 version INTEGER NOT NULL DEFAULT 1,
 last_event TEXT NOT NULL,
 interval INTEGER NOT NULL DEFAULT 1 CHECK(interval BETWEEN 1 AND 100),
 day INTEGER CHECK(day BETWEEN 1 AND 31),
 month INTEGER CHECK(month BETWEEN 1 AND 12)
);
INSERT INTO reminders_calendar (id,group_id,title,kind,anchor_at,next_at,status,version,last_event)
 SELECT id,group_id,title,kind,anchor_at,next_at,status,version,last_event FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_calendar RENAME TO reminders;
CREATE INDEX reminders_due ON reminders(group_id,status,next_at);
