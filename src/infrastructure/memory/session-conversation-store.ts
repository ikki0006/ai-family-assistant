import type { Session, Sessions } from "agents/sessions";
import type {
	ConversationMessage,
	ConversationSnapshot,
	MemoryBatch,
	MemoryReference,
} from "../../application/conversation/conversation";
import type { ConversationStore } from "../../application/ports/conversation-store";

export const RETENTION_MS = 7 * 86400000;
type IndexRow = {
	id: string;
	event_id: string;
	day: string;
	at: number;
	role: "user" | "assistant";
};
export class SessionConversationStore implements ConversationStore {
	constructor(
		private readonly sql: SqlStorage,
		private readonly sessions: Sessions,
	) {
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_meta (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, revision INTEGER NOT NULL, reset_at INTEGER NOT NULL)",
		);
		sql.exec("INSERT OR IGNORE INTO family_meta VALUES (1,0,0,0)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS memory_processed (id TEXT PRIMARY KEY,at INTEGER NOT NULL)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS memory_lease (id INTEGER PRIMARY KEY,token TEXT NOT NULL,until_at INTEGER NOT NULL,revision INTEGER NOT NULL,epoch INTEGER NOT NULL)",
		);
		sql.exec("CREATE TABLE IF NOT EXISTS memory_deletions (id TEXT PRIMARY KEY)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_outgoing (id TEXT PRIMARY KEY,text TEXT NOT NULL,at INTEGER NOT NULL)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_participation (id INTEGER PRIMARY KEY,last_scan INTEGER NOT NULL,last_suggestion INTEGER NOT NULL)",
		);
		sql.exec("INSERT OR IGNORE INTO family_participation VALUES (1,0,0)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_messages (id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,day TEXT NOT NULL,at INTEGER NOT NULL,role TEXT NOT NULL)",
		);
		sql.exec("CREATE INDEX IF NOT EXISTS family_messages_time ON family_messages(at)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_tombstones (id TEXT PRIMARY KEY,at INTEGER NOT NULL)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS family_summaries (day TEXT PRIMARY KEY,text TEXT NOT NULL,through_at INTEGER NOT NULL)",
		);
		sql.exec("CREATE TABLE IF NOT EXISTS family_resets (id TEXT PRIMARY KEY,at INTEGER NOT NULL)");
	}
	pendingMemoryDeletions(): string[] {
		return this.sql
			.exec<{ id: string }>("SELECT id FROM memory_deletions")
			.toArray()
			.map((r) => r.id);
	}
	finishMemoryDeletion(id: string) {
		this.sql.exec("DELETE FROM memory_deletions WHERE id=?", id);
	}
	claimMemory(now: number, force = false): string | null {
		const lease = this.sql
			.exec<{ until_at: number }>("SELECT until_at FROM memory_lease WHERE id=1")
			.toArray()[0];
		if (lease && lease.until_at > now) return null;
		const pending = this.sql
			.exec<{ first_at: number | null }>(
				"SELECT MIN(at) AS first_at FROM family_messages WHERE id NOT IN (SELECT id FROM memory_processed)",
			)
			.one().first_at;
		const last = this.sql
			.exec<{ last_at: number | null }>("SELECT MAX(at) AS last_at FROM family_messages")
			.one().last_at;
		if (
			pending === null ||
			last === null ||
			(!force && now - last < 15 * 60000 && now - pending < 3600000)
		)
			return null;
		const token = crypto.randomUUID();
		const meta = this.meta();
		this.sql.exec(
			"INSERT OR REPLACE INTO memory_lease VALUES (1,?,?,?,?)",
			token,
			now + 15 * 60000,
			meta.revision,
			meta.epoch,
		);
		return token;
	}
	releaseMemory(token: string) {
		this.sql.exec("DELETE FROM memory_lease WHERE token=?", token);
	}
	memoryLeaseValid(token: string, now: number): boolean {
		const meta = this.meta();
		return (
			this.sql
				.exec(
					"SELECT id FROM memory_lease WHERE token=? AND until_at>? AND revision=? AND epoch=?",
					token,
					now,
					meta.revision,
					meta.epoch,
				)
				.toArray().length === 1
		);
	}
	async memoryBatch(token: string, now: number): Promise<MemoryBatch | null> {
		await this.prune(now);
		if (!this.memoryLeaseValid(token, now)) return null;
		const rows = this.sql
			.exec<IndexRow>(
				"SELECT * FROM family_messages WHERE id NOT IN (SELECT id FROM memory_processed) ORDER BY at,id LIMIT 100",
			)
			.toArray();
		const day = rows[0]?.day;
		if (!day) return null;
		const selected: ConversationMessage[] = [];
		let size = 0;
		for (const row of rows) {
			if (row.day !== day) break;
			const stored = await this.session(day).getMessage(row.id);
			if (!stored) continue;
			const text = stored.parts
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join("\n");
			size += new TextEncoder().encode(text).length + 200;
			if (size > 12000 && selected.length) {
				// Never mark a summary through a partially selected timestamp.
				while (selected.at(-1)?.occurredAt === row.at) selected.pop();
				break;
			}
			selected.push({
				id: row.id,
				day,
				occurredAt: row.at,
				role: row.role,
				text,
				speaker: (stored.metadata as { speaker?: string } | undefined)?.speaker ?? "unknown",
			});
		}
		if (!selected.length) return null;
		// LIMIT must not hide additional messages with the last timestamp.
		const through = selected.at(-1)?.occurredAt ?? 0;
		const atCount = this.sql
			.exec<{ n: number }>(
				"SELECT COUNT(*) AS n FROM family_messages WHERE at=? AND id NOT IN (SELECT id FROM memory_processed)",
				through,
			)
			.one().n;
		if (atCount > selected.filter((m) => m.occurredAt === through).length)
			while (selected.at(-1)?.occurredAt === through) selected.pop();
		if (!selected.length) return null;
		const previous =
			this.sql
				.exec<{ text: string }>("SELECT text FROM family_summaries WHERE day=?", day)
				.toArray()[0]?.text ?? "";
		return { messages: selected, previousSummary: previous, day, ...this.meta() };
	}
	async completeMemory(batch: MemoryBatch, summary: string) {
		await this.saveSummary(
			batch.day,
			summary,
			batch.messages.at(-1)?.occurredAt ?? 0,
			batch.revision,
		);
		for (const m of batch.messages)
			this.sql.exec("INSERT OR IGNORE INTO memory_processed VALUES (?,?)", m.id, m.occurredAt);
	}

	recordOutgoing(id: string, text: string, now: number) {
		this.sql.exec("INSERT OR REPLACE INTO family_outgoing VALUES (?,?,?)", id, text, now);
	}
	outgoing(id: string, now: number): string | undefined {
		return this.sql
			.exec<{ text: string }>(
				"SELECT text FROM family_outgoing WHERE id=? AND at>?",
				id,
				now - RETENTION_MS,
			)
			.toArray()[0]?.text;
	}
	participation() {
		return this.sql
			.exec<{ last_scan: number; last_suggestion: number }>(
				"SELECT * FROM family_participation WHERE id=1",
			)
			.one();
	}
	markScan(now: number) {
		this.sql.exec("UPDATE family_participation SET last_scan=? WHERE id=1", now);
	}
	markSuggestion(now: number) {
		this.sql.exec("UPDATE family_participation SET last_suggestion=? WHERE id=1", now);
	}
	meta() {
		return this.sql
			.exec<{ epoch: number; revision: number; reset_at: number }>(
				"SELECT * FROM family_meta WHERE id=1",
			)
			.one();
	}
	private session(day: string): Session {
		return this.sessions.session(day);
	}
	async append(
		message: ConversationMessage,
		eventId: string,
		now: number,
	): Promise<MemoryReference | null> {
		await this.prune(now);
		const meta = this.meta();
		if (
			message.occurredAt <= meta.reset_at ||
			message.occurredAt < now - RETENTION_MS ||
			message.occurredAt > now + 60000 ||
			this.sql.exec("SELECT id FROM family_tombstones WHERE id=?", message.id).toArray().length
		)
			return null;
		const duplicate = this.sql
			.exec<IndexRow>("SELECT * FROM family_messages WHERE event_id=? OR id=?", eventId, message.id)
			.toArray()[0];
		if (duplicate) return { messageId: duplicate.id, epoch: meta.epoch };
		if (
			message.role === "user" &&
			this.sql
				.exec("SELECT id FROM family_messages WHERE at>=? LIMIT 1", message.occurredAt)
				.toArray().length
		)
			this.invalidate();
		await this.session(message.day).appendMessage({
			id: message.id,
			role: message.role,
			parts: [{ type: "text", text: message.text }],
			createdAt: new Date(message.occurredAt),
			metadata: { speaker: message.speaker, occurredAt: message.occurredAt, day: message.day },
		});
		this.sql.exec(
			"INSERT INTO family_messages VALUES (?,?,?,?,?)",
			message.id,
			eventId,
			message.day,
			message.occurredAt,
			message.role,
		);
		// A late event can make an existing daily summary stale.
		this.sql.exec(
			"DELETE FROM family_summaries WHERE day=? AND through_at>=?",
			message.day,
			message.occurredAt,
		);
		return { messageId: message.id, epoch: meta.epoch };
	}
	async snapshot(reference: MemoryReference, now: number): Promise<ConversationSnapshot | null> {
		await this.prune(now);
		const meta = this.meta();
		const current = this.sql
			.exec<IndexRow>("SELECT * FROM family_messages WHERE id=?", reference.messageId)
			.toArray()[0];
		if (meta.epoch !== reference.epoch || !current) return null;
		const rows = this.sql
			.exec<IndexRow>(
				"SELECT * FROM family_messages WHERE at<=? AND at>(SELECT reset_at FROM family_meta WHERE id=1) ORDER BY at DESC,id DESC LIMIT 300",
				current.at,
			)
			.toArray()
			.reverse();
		const summaries = this.sql
			.exec<{ day: string; text: string; through_at: number }>(
				"SELECT * FROM family_summaries WHERE through_at<? ORDER BY day",
				current.at,
			)
			.toArray()
			.map((s) => ({ day: s.day, text: s.text, through: s.through_at }));
		const messages: ConversationMessage[] = [];
		for (const row of rows) {
			if (row.id !== current.id && summaries.some((s) => s.day === row.day && row.at <= s.through))
				continue;
			const stored = await this.session(row.day).getMessage(row.id);
			if (!stored) continue;
			const metadata = stored.metadata as { speaker?: string } | undefined;
			messages.push({
				id: row.id,
				day: row.day,
				occurredAt: row.at,
				role: row.role,
				speaker: metadata?.speaker ?? "unknown",
				text: stored.parts
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n"),
			});
		}
		// The triggering question is always last, even when timestamps tie.
		const question = messages.find((m) => m.id === current.id);
		if (!question) return null;
		return {
			revision: meta.revision,
			epoch: meta.epoch,
			summaries,
			messages: [...messages.filter((m) => m.id !== current.id), question],
		};
	}
	async saveSummary(
		day: string,
		text: string,
		through: number,
		revision: number,
	): Promise<boolean> {
		if (this.meta().revision !== revision) return false;
		const previous = this.sql
			.exec<{ through_at: number }>("SELECT through_at FROM family_summaries WHERE day=?", day)
			.toArray()[0];
		if (previous && previous.through_at >= through) return false;
		this.sql.exec(
			"INSERT INTO family_summaries VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text,through_at=excluded.through_at",
			day,
			text,
			through,
		);
		return true;
	}
	private invalidate() {
		this.sql.exec("UPDATE family_meta SET revision=revision+1 WHERE id=1");
		this.sql.exec("DELETE FROM family_summaries");
	}
	async forget(messageId: string, now: number): Promise<void> {
		this.sql.exec("INSERT OR IGNORE INTO memory_deletions VALUES (?)", messageId);
		this.sql.exec("INSERT OR REPLACE INTO family_tombstones VALUES (?,?)", messageId, now);
		this.invalidate();
		this.sql.exec("DELETE FROM family_outgoing");
		// All assistant messages could contain information derived from the removed message.
		const rows = this.sql
			.exec<IndexRow>("SELECT * FROM family_messages WHERE id=? OR role='assistant'", messageId)
			.toArray();
		for (const row of rows) {
			await this.session(row.day).deleteMessages([row.id]);
			this.sql.exec("DELETE FROM family_messages WHERE id=?", row.id);
		}
	}
	async reset(eventId: string, occurredAt: number, now: number): Promise<void> {
		if (this.sql.exec("SELECT id FROM family_resets WHERE id=?", eventId).toArray().length) return;
		this.sql.exec("INSERT INTO family_resets VALUES (?,?)", eventId, now);
		this.sql.exec("INSERT OR IGNORE INTO memory_deletions VALUES ('*')");
		this.sql.exec("DELETE FROM memory_processed");
		this.sql.exec("DELETE FROM memory_lease");
		this.sql.exec(
			"UPDATE family_meta SET epoch=epoch+1,revision=revision+1,reset_at=MAX(reset_at,?) WHERE id=1",
			Math.max(occurredAt, now),
		);
		for (const row of this.sql
			.exec<{ day: string }>("SELECT DISTINCT day FROM family_messages")
			.toArray())
			await this.session(row.day).clearMessages();
		this.sql.exec("DELETE FROM family_messages");
		this.sql.exec("DELETE FROM family_outgoing");
		this.sql.exec("DELETE FROM family_summaries");
	}
	async prune(now: number): Promise<void> {
		this.sql.exec("DELETE FROM memory_processed WHERE at<?", now - RETENTION_MS);
		this.sql.exec("DELETE FROM family_outgoing WHERE at<?", now - RETENTION_MS);
		const rows = this.sql
			.exec<IndexRow>(
				"SELECT * FROM family_messages WHERE at<? OR at<=(SELECT reset_at FROM family_meta WHERE id=1) OR id IN (SELECT id FROM family_tombstones) OR (role='assistant' AND at<=(SELECT MAX(at) FROM family_tombstones))",
				now - RETENTION_MS,
			)
			.toArray();
		if (rows.length) this.invalidate();
		for (const row of rows) {
			await this.session(row.day).deleteMessages([row.id]);
			this.sql.exec("DELETE FROM family_messages WHERE id=?", row.id);
		}
		this.sql.exec("DELETE FROM family_tombstones WHERE at<?", now - RETENTION_MS - 86400000);
		this.sql.exec("DELETE FROM family_resets WHERE at<?", now - RETENTION_MS - 86400000);
	}
}
