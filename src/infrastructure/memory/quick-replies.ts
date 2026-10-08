import type { QuickReply, ReplyChoice } from "../../application/ports/quick-reply";
export class QuickReplies {
	constructor(private readonly sql: SqlStorage) {
		sql.exec(
			"CREATE TABLE IF NOT EXISTS quick_replies (id TEXT PRIMARY KEY,batch TEXT NOT NULL,owner TEXT,payload TEXT NOT NULL,expires INTEGER NOT NULL)",
		);
	}
	issue(
		items: { label: string; choice: ReplyChoice }[],
		owner: string | null,
		now: number,
		ttl = 15 * 60000,
	): QuickReply[] {
		this.prune(now);
		// Bound storage if questions go unanswered.
		this.sql.exec(
			"DELETE FROM quick_replies WHERE batch IN (SELECT batch FROM quick_replies GROUP BY batch ORDER BY MIN(expires) DESC LIMIT -1 OFFSET 50)",
		);
		const batch = crypto.randomUUID();
		return items.map(({ label, choice }) => {
			const id = crypto.randomUUID();
			this.sql.exec(
				"INSERT INTO quick_replies VALUES(?,?,?,?,?)",
				id,
				batch,
				owner,
				JSON.stringify(choice),
				now + ttl,
			);
			return { label, data: `qr:${id}`, displayText: label };
		});
	}
	consume(data: string, speaker: string | undefined, now: number): ReplyChoice | null {
		if (!/^qr:[a-f0-9-]{36}$/.test(data)) return null;
		const row = this.sql
			.exec<{ batch: string; owner: string | null; payload: string }>(
				"SELECT * FROM quick_replies WHERE id=? AND expires>?",
				data.slice(3),
				now,
			)
			.toArray()[0];
		if (!row || (row.owner && row.owner !== speaker)) return null;
		this.sql.exec("DELETE FROM quick_replies WHERE batch=?", row.batch);
		return JSON.parse(row.payload) as ReplyChoice;
	}
	clearOwner(owner: string) {
		this.sql.exec("DELETE FROM quick_replies WHERE owner=?", owner);
	}
	prune(now: number) {
		this.sql.exec("DELETE FROM quick_replies WHERE expires<=?", now);
	}
	clear() {
		this.sql.exec("DELETE FROM quick_replies");
	}
}
