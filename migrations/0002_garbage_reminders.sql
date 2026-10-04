-- Actual collection schedules are populated separately, never committed here.
CREATE TABLE garbage_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE reminder_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX reminder_deliveries_sent_at ON reminder_deliveries(sent_at);
