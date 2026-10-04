import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import migration from "../../migrations/0004_improvements.sql?raw";
import profileMigration from "../../migrations/0007_family_profiles.sql?raw";
import { createImprovementRepository } from "../../src/infrastructure/persistence/d1/improvement-repository";

const db = (env as unknown as { DB: D1Database }).DB;
const repository = createImprovementRepository(db);
beforeAll(async () => {
	await (env as unknown as { DB: D1Database }).DB.exec(profileMigration.replace(/\n/g, " "));
	await db.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.exec("DELETE FROM improvements;");
});

it("deduplicates inbound proposals and atomically claims an approval", async () => {
	const first = await repository.create("group", "event", "Fictional improvement");
	const second = await repository.create("group", "event", "Ignored duplicate");
	expect(first.id).toBe(second.id);
	const claims = await Promise.all([
		repository.claim("group", first.id, 1),
		repository.claim("group", first.id, 1),
	]);
	expect(claims.filter(Boolean)).toHaveLength(1);
	await repository.finish("group", first.id, "uncertain");
	expect(await repository.claim("group", first.id, 1)).toBe(false);
});

it("rejects expired approvals and isolates groups", async () => {
	const row = await repository.create("group", "event", "Fictional improvement");
	expect(await repository.get("other", row.id)).toBeNull();
	expect(await repository.claim("other", row.id, 1)).toBe(false);
	await db
		.prepare("UPDATE improvements SET created_at = unixepoch() - 86401 WHERE id = ?")
		.bind(row.id)
		.run();
	expect(await repository.claim("group", row.id, 1)).toBe(false);
});
