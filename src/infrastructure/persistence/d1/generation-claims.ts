// Operational deduplication only: no conversations or answers are stored here.
export function createGenerationClaims(db: D1Database) {
	return {
		async claim(eventId: string, now: number): Promise<boolean> {
			await db
				.prepare("DELETE FROM generation_claims WHERE created_at < ?")
				.bind(now - 7 * 24 * 60 * 60 * 1000)
				.run();
			const result = await db
				.prepare(
					"INSERT INTO generation_claims (event_id, created_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING",
				)
				.bind(eventId, now)
				.run();
			return result.meta.changes === 1;
		},
	};
}
