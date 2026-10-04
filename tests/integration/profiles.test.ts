import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import memoryMigration from "../../migrations/0005_long_term_memories.sql?raw";
import migration from "../../migrations/0007_family_profiles.sql?raw";
import { createFamilyProfiles } from "../../src/infrastructure/persistence/d1/family-profiles";
const db = (env as unknown as { DB: D1Database }).DB;
const repo = createFamilyProfiles(db);
const speaker = `U${"1".repeat(32)}`;
beforeAll(async () => {
	await db.exec(memoryMigration.replace(/\n/g, " "));
	await db.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.exec("DELETE FROM family_profiles");
});
it("keeps proposals separate, requires current version and isolates families", async () => {
	await repo.propose("g", {
		speaker,
		names: ["たろう"],
		occurredAt: Date.now() + 1,
		sourceIds: ["m1"],
	});
	expect(await repo.list("other")).toEqual([]);
	expect((await repo.list("g"))[0]?.names).toEqual([]);
	expect(await repo.confirm("g", "other", 1)).toBe(false);
	await repo.propose("g", {
		speaker,
		names: ["太郎"],
		occurredAt: Date.now() + 1,
		sourceIds: ["m2"],
	});
	expect(await repo.confirm("g", speaker, 1)).toBe(false);
	expect(await repo.confirm("g", speaker, 2)).toBe(true);
	await repo.propose("g", {
		speaker,
		names: ["たろちゃん"],
		occurredAt: Date.now() + 1,
		sourceIds: ["m3"],
	});
	expect((await repo.list("g"))[0]?.names).toEqual(["太郎"]);
	await repo.removeSources("g", ["m2"]);
	expect(await repo.list("g")).toEqual([]);
});
it("deletion removes confirmed and pending data", async () => {
	await repo.propose("g", {
		speaker,
		names: ["太郎"],
		occurredAt: Date.now() + 1,
		sourceIds: ["m"],
	});
	await repo.confirm("g", speaker, 1);
	await repo.clear("other");
	expect(await repo.list("g")).toHaveLength(1);
	await repo.clear("g");
	expect(await repo.list("g")).toEqual([]);
});

it("does not restore an old extracted name after the person corrects it", async () => {
	await repo.propose("g", { speaker, names: ["訂正後"], sourceIds: ["new"], occurredAt: 1 });
	await repo.confirm("g", speaker, 1);
	await repo.propose("g", { speaker, names: ["訂正前"], sourceIds: ["old"], occurredAt: 1 });
	expect((await repo.list("g"))[0]).toMatchObject({ names: ["訂正後"], pending: [] });
});

it("keeps profiles on history reset but clears them with the explicit combined command", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const namespace = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	await runInDurableObject(
		namespace.get(namespace.idFromName(crypto.randomUUID())),
		async (instance) => {
			Object.defineProperty(instance, "env", {
				value: { DB: db, LINE_ALLOWED_GROUP_ID: "g", LINE_CHANNEL_ACCESS_TOKEN: "test" },
				configurable: true,
			});
			const original = globalThis.fetch;
			globalThis.fetch = async () => Response.json({ sentMessages: [{ id: crypto.randomUUID() }] });
			try {
				let sequence = 0;
				const send = async (text: string) => {
					sequence++;
					await instance.receive({
						chatType: "group",
						groupId: "g",
						speaker,
						mentioned: true,
						text,
						eventId: `e${sequence}`,
						messageId: `m${sequence}`,
						occurredAt: Date.now(),
						replyToken: "r",
					});
				};
				await send("プロフィール登録: テスト太郎、たろう");
				expect((await repo.list("g"))[0]?.names).toEqual(["テスト太郎", "たろう"]);
				await send("履歴リセット");
				expect(await repo.list("g")).toHaveLength(1);
				await send("記憶・プロフィール全消去");
				expect(await repo.list("g")).toEqual([]);
			} finally {
				globalThis.fetch = original;
			}
		},
	);
});
