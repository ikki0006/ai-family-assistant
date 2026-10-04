import type { LongTermMemory, MemoryFact } from "../../../application/ports/long-term-memory";
export function createLongTermMemory(db: D1Database): LongTermMemory {
	return {
		async list(group, now) {
			await db
				.prepare("DELETE FROM long_term_memories WHERE group_id=? AND expires_at<=?")
				.bind(group, now)
				.run();
			const result = await db
				.prepare(
					"SELECT * FROM long_term_memories WHERE group_id=? ORDER BY updated_at DESC,id LIMIT 200",
				)
				.bind(group)
				.all<{
					id: string;
					subject: string;
					fact_key: string;
					text: string;
					source_ids: string;
					expires_at: number | null;
					updated_at: number;
				}>();
			return result.results.map((r) => ({
				id: r.id,
				subject: r.subject,
				key: r.fact_key,
				text: r.text,
				sourceIds: JSON.parse(r.source_ids) as string[],
				expiresAt: r.expires_at,
				updatedAt: r.updated_at,
			}));
		},
		async apply(group, updates, retire, now) {
			const existing = await this.list(group, now);
			const statements: D1PreparedStatement[] = retire.map((id) =>
				db.prepare("DELETE FROM long_term_memories WHERE group_id=? AND id=?").bind(group, id),
			);
			let count = existing.filter((f) => !retire.includes(f.id)).length;
			for (const update of updates) {
				const old = existing.find((f) => f.subject === update.subject && f.key === update.key);
				if (!old && count >= 200) continue;
				if (!old) count++;
				// Preserve provenance through corrections, so unsend removes derived facts too.
				const sources = [...new Set([...(old?.sourceIds ?? []), ...update.sourceIds])];
				if (sources.length > 200) continue;
				statements.push(
					db
						.prepare(
							"INSERT INTO long_term_memories VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(group_id,subject,fact_key) DO UPDATE SET text=excluded.text,source_ids=excluded.source_ids,expires_at=excluded.expires_at,updated_at=excluded.updated_at",
						)
						.bind(
							old?.id ?? crypto.randomUUID(),
							group,
							update.subject,
							update.key,
							update.text,
							JSON.stringify(sources),
							update.expiresAt,
							now,
						),
				);
			}
			if (statements.length) await db.batch(statements);
		},
		async removeSources(group, ids) {
			const rows = await db
				.prepare("SELECT id,source_ids FROM long_term_memories WHERE group_id=?")
				.bind(group)
				.all<{ id: string; source_ids: string }>();
			const selected = rows.results.filter((r) =>
				(JSON.parse(r.source_ids) as MemoryFact["sourceIds"]).some((id) => ids.includes(id)),
			);
			if (selected.length)
				await db.batch(
					selected.map((r) =>
						db
							.prepare("DELETE FROM long_term_memories WHERE group_id=? AND id=?")
							.bind(group, r.id),
					),
				);
		},
		async clear(group) {
			await db.prepare("DELETE FROM long_term_memories WHERE group_id=?").bind(group).run();
		},
	};
}
