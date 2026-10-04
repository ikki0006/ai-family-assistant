import type { FamilyProfile, FamilyProfiles } from "../../../application/ports/family-profiles";
type Row = {
	speaker: string;
	names_json: string;
	pending_json: string;
	source_ids_json: string;
	version: number;
};
export function createFamilyProfiles(db: D1Database): FamilyProfiles {
	return {
		async list(group) {
			const rows = await db
				.prepare("SELECT * FROM family_profiles WHERE group_id=? ORDER BY speaker LIMIT 10")
				.bind(group)
				.all<Row>();
			return rows.results.map(
				(r) =>
					({
						speaker: r.speaker,
						names: JSON.parse(r.names_json),
						pending: JSON.parse(r.pending_json),
						sourceIds: JSON.parse(r.source_ids_json),
						version: r.version,
					}) as FamilyProfile,
			);
		},
		async propose(group, p) {
			const confirmed = await db
				.prepare("SELECT confirmed_at FROM family_profiles WHERE group_id=? AND speaker=?")
				.bind(group, p.speaker)
				.first<{ confirmed_at: number }>();
			if (confirmed && p.occurredAt <= confirmed.confirmed_at) return;
			const rows = await this.list(group);
			const old = rows.find((r) => r.speaker === p.speaker);
			if (!old && rows.length >= 10) return;
			if (
				JSON.stringify(old?.names) === JSON.stringify(p.names) ||
				JSON.stringify(old?.pending) === JSON.stringify(p.names)
			)
				return;
			const sources = [...new Set([...(old?.sourceIds ?? []), ...p.sourceIds])];
			if (sources.length > 100) return;
			await db
				.prepare(
					"INSERT INTO family_profiles(group_id,speaker,pending_json,source_ids_json) VALUES(?,?,?,?) ON CONFLICT(group_id,speaker) DO UPDATE SET pending_json=excluded.pending_json,source_ids_json=excluded.source_ids_json,version=family_profiles.version+1",
				)
				.bind(group, p.speaker, JSON.stringify(p.names), JSON.stringify(sources))
				.run();
		},
		async confirm(group, speaker, version) {
			const result = await db
				.prepare(
					"UPDATE family_profiles SET names_json=pending_json,pending_json='[]',confirmed_at=?,version=version+1 WHERE group_id=? AND speaker=? AND version=? AND pending_json!='[]'",
				)
				.bind(Date.now(), group, speaker, version)
				.run();
			return result.meta.changes === 1;
		},
		async removeSources(group, ids) {
			for (const row of await this.list(group))
				if (row.sourceIds.some((id) => ids.includes(id))) await this.remove(group, row.speaker);
		},
		async remove(group, speaker) {
			await db
				.prepare("DELETE FROM family_profiles WHERE group_id=? AND speaker=?")
				.bind(group, speaker)
				.run();
		},
		async clear(group) {
			await db.prepare("DELETE FROM family_profiles WHERE group_id=?").bind(group).run();
		},
	};
}
