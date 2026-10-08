type Question = {
	id: string;
	owner: string;
	text: string;
	created: number;
	expires: number;
	attempts: number;
};
export class PendingQuestions {
	constructor(private readonly sql: SqlStorage) {
		sql.exec(
			"CREATE TABLE IF NOT EXISTS pending_questions (owner TEXT PRIMARY KEY,id TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL)",
		);
	}
	set(owner: string, text: string, now: number) {
		this.prune(now);
		this.sql.exec(
			"INSERT OR REPLACE INTO pending_questions VALUES (?,?,?,?,?,0)",
			owner,
			crypto.randomUUID(),
			text.slice(0, 2000),
			now,
			now + 10 * 60000,
		);
	}
	get(owner: string, id: string, now: number): Question | undefined {
		return this.sql
			.exec<Question>(
				"SELECT * FROM pending_questions WHERE owner=? AND id=? AND expires>?",
				owner,
				id,
				now,
			)
			.toArray()[0];
	}
	candidate(owner: string, occurredAt: number, now: number): Question | undefined {
		this.prune(now);
		return this.sql
			.exec<Question>(
				"UPDATE pending_questions SET attempts=attempts+1 WHERE owner=? AND created<=? AND attempts<5 RETURNING *",
				owner,
				occurredAt,
			)
			.toArray()[0];
	}
	remove(owner: string) {
		this.sql.exec("DELETE FROM pending_questions WHERE owner=?", owner);
	}
	prune(now: number) {
		this.sql.exec("DELETE FROM pending_questions WHERE expires<=?", now);
	}
	clear() {
		this.sql.exec("DELETE FROM pending_questions");
	}
}
