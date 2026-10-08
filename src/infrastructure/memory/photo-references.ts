// IDs only: never store image bytes or extracted financial information.
export class PhotoReferences {
	constructor(private readonly sql: SqlStorage) {
		sql.exec("CREATE TABLE IF NOT EXISTS photo_deletions(id TEXT PRIMARY KEY,at INTEGER NOT NULL)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS photo_references(id TEXT PRIMARY KEY,at INTEGER NOT NULL)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS photo_requests(event TEXT PRIMARY KEY,image TEXT NOT NULL,at INTEGER NOT NULL)",
		);
	}
	prune(now: number) {
		this.sql.exec("DELETE FROM photo_deletions WHERE at<?", now - 86400000);
		this.sql.exec("DELETE FROM photo_references WHERE at<?", now - 86400000);
		this.sql.exec(
			"DELETE FROM photo_requests WHERE at<? OR image NOT IN (SELECT id FROM photo_references)",
			now - 86400000,
		);
	}
	record(id: string, at: number, now: number) {
		this.prune(now);
		if (
			at < now - 86400000 ||
			at > now + 60000 ||
			this.sql.exec("SELECT id FROM photo_deletions WHERE id=?", id).toArray().length
		)
			return;
		this.sql.exec("INSERT OR IGNORE INTO photo_references VALUES(?,?)", id, at);
		this.sql.exec(
			"DELETE FROM photo_references WHERE id IN (SELECT id FROM photo_references ORDER BY at DESC LIMIT -1 OFFSET 100)",
		);
	}
	has(id: string, now: number) {
		this.prune(now);
		return this.sql.exec("SELECT id FROM photo_references WHERE id=?", id).toArray().length === 1;
	}
	request(event: string, image: string, now: number) {
		if (!this.has(image, now)) return false;
		this.sql.exec("INSERT OR IGNORE INTO photo_requests VALUES(?,?,?)", event, image, now);
		return this.valid(event, image, now);
	}
	valid(event: string, image: string, now: number) {
		this.prune(now);
		return (
			this.sql
				.exec("SELECT event FROM photo_requests WHERE event=? AND image=?", event, image)
				.toArray().length === 1
		);
	}
	forget(id: string) {
		this.sql.exec("INSERT OR REPLACE INTO photo_deletions VALUES(?,?)", id, Date.now());
		this.sql.exec("DELETE FROM photo_references WHERE id=?", id);
		this.sql.exec("DELETE FROM photo_requests WHERE image=? OR event=?", id, id);
	}
	finish(event: string) {
		this.sql.exec("DELETE FROM photo_requests WHERE event=?", event);
	}
	clear() {
		this.sql.exec("DELETE FROM photo_requests");
		this.sql.exec("DELETE FROM photo_references");
	}
}
