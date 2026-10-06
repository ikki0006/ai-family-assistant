import type { FamilyList, FamilyLists } from "../../../application/ports/family-lists";
export function createFamilyLists(db: D1Database): FamilyLists {
	return {
		async load(group) {
			const row = await db
				.prepare("SELECT version,lists_json FROM family_list_state WHERE group_id=?")
				.bind(group)
				.first<{ version: number; lists_json: string }>();
			return row
				? { version: row.version, lists: JSON.parse(row.lists_json) as FamilyList[] }
				: { version: 0, lists: [] };
		},
		async applied(group, event) {
			return !!(await db
				.prepare("SELECT 1 FROM family_list_events WHERE group_id=? AND event_id=?")
				.bind(group, event)
				.first());
		},
		async save(group, event, previous, lists) {
			const result = await db.batch([
				db.prepare("INSERT OR IGNORE INTO family_list_state(group_id) VALUES(?)").bind(group),
				db
					.prepare(
						"UPDATE family_list_state SET lists_json=?,version=version+1,last_event=? WHERE group_id=? AND version=? AND NOT EXISTS(SELECT 1 FROM family_list_events WHERE group_id=? AND event_id=?)",
					)
					.bind(JSON.stringify(lists), event, group, previous.version, group, event),
				db
					.prepare(
						"INSERT OR IGNORE INTO family_list_events SELECT group_id,? FROM family_list_state WHERE group_id=? AND last_event=? AND version=?",
					)
					.bind(event, group, event, previous.version + 1),
			]);
			return result[1]?.meta.changes === 1;
		},
	};
}
