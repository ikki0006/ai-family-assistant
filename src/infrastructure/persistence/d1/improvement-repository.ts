import type {
	Improvement,
	ImprovementRepository,
} from "../../../application/ports/improvement-repository";

export function createImprovementRepository(db: D1Database): ImprovementRepository {
	const projection = "id, group_id AS groupId, specification, version, status";
	return {
		async create(groupId, eventId, specification) {
			await db
				.prepare(
					"INSERT OR IGNORE INTO improvements (id, group_id, event_id, specification, version, status) VALUES (?, ?, ?, ?, 1, 'pending')",
				)
				.bind(crypto.randomUUID(), groupId, eventId, specification)
				.run();
			const row = await db
				.prepare(`SELECT ${projection} FROM improvements WHERE group_id = ? AND event_id = ?`)
				.bind(groupId, eventId)
				.first<Improvement>();
			if (!row) throw new Error("Improvement persistence failed");
			return row;
		},
		get(groupId, id) {
			return db
				.prepare(`SELECT ${projection} FROM improvements WHERE group_id = ? AND id = ?`)
				.bind(groupId, id)
				.first<Improvement>();
		},
		async claim(groupId, id, version) {
			const result = await db
				.prepare(
					"UPDATE improvements SET status = 'dispatching' WHERE group_id = ? AND id = ? AND version = ? AND status = 'pending' AND created_at >= unixepoch() - 86400",
				)
				.bind(groupId, id, version)
				.run();
			return result.meta.changes === 1;
		},
		async finish(groupId, id, status) {
			await db
				.prepare(
					"UPDATE improvements SET status = ? WHERE group_id = ? AND id = ? AND status = 'dispatching'",
				)
				.bind(status, groupId, id)
				.run();
		},
	};
}
