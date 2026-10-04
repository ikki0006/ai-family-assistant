CREATE TABLE family_profiles (
 group_id TEXT NOT NULL,
 speaker TEXT NOT NULL,
 names_json TEXT NOT NULL DEFAULT '[]',
 pending_json TEXT NOT NULL DEFAULT '[]',
 source_ids_json TEXT NOT NULL DEFAULT '[]',
 confirmed_at INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(group_id,speaker)
);
