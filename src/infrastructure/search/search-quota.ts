// One allowed family group per deployment. Count attempts, including failures.
export function reserveSearch(sql: SqlStorage, now: number): boolean {
	sql.exec(
		"CREATE TABLE IF NOT EXISTS search_usage (month TEXT PRIMARY KEY, count INTEGER NOT NULL)",
	);
	const month = new Date(now).toISOString().slice(0, 7);
	const rows = sql
		.exec<{ count: number }>(
			"INSERT INTO search_usage (month,count) VALUES (?,1) ON CONFLICT(month) DO UPDATE SET count=count+1 WHERE count<900 RETURNING count",
			month,
		)
		.toArray();
	sql.exec("DELETE FROM search_usage WHERE month < ?", month);
	return rows.length > 0;
}
