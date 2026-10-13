import type { FamilyTasks } from "../../../application/ports/family-tasks";
import type { FamilyTask } from "../../../domain/tasks/task";
export function createFamilyTasks(db: D1Database): FamilyTasks {
	return {
		async load(group) {
			const row = await db
				.prepare("SELECT version,tasks_json FROM family_task_state WHERE group_id=?")
				.bind(group)
				.first<{ version: number; tasks_json: string }>();
			return row
				? { version: row.version, tasks: JSON.parse(row.tasks_json) as FamilyTask[] }
				: { version: 0, tasks: [] };
		},
		async applied(group, event) {
			return !!(await db
				.prepare("SELECT 1 FROM family_task_events WHERE group_id=? AND event_id=?")
				.bind(group, event)
				.first());
		},
		async save(group, event, previous, tasks) {
			const result = await db.batch([
				db.prepare("INSERT OR IGNORE INTO family_task_state(group_id) VALUES(?)").bind(group),
				db
					.prepare(
						"UPDATE family_task_state SET tasks_json=?,version=version+1,last_event=? WHERE group_id=? AND version=? AND NOT EXISTS(SELECT 1 FROM family_task_events WHERE group_id=? AND event_id=?)",
					)
					.bind(JSON.stringify(tasks), event, group, previous.version, group, event),
				db
					.prepare(
						"INSERT OR IGNORE INTO family_task_events SELECT group_id,? FROM family_task_state WHERE group_id=? AND last_event=? AND version=?",
					)
					.bind(event, group, event, previous.version + 1),
			]);
			return result[1]?.meta.changes === 1;
		},
	};
}

export async function familyTasksReady(db: D1Database): Promise<boolean> {
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('family_task_state','family_task_events')",
		)
		.first<{ n: number }>();
	return row?.n === 2;
}
