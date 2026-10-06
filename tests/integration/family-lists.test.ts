import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import migration from "../../migrations/0008_family_lists.sql?raw";
import { manageLists } from "../../src/application/lists/manage-lists";
import { createFamilyLists } from "../../src/infrastructure/persistence/d1/family-lists";
const db = (env as unknown as { DB: D1Database }).DB;
const repo = createFamilyLists(db);
beforeAll(async () => {
	await db.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM family_list_events"),
		db.prepare("DELETE FROM family_list_state"),
	]);
});
it("creates independent lists, recognizes name variants, edits and removes items", async () => {
	await manageLists(repo, "g", "a", { op: "create", name: "行きたいお店", text: "架空カフェ" }, 0);
	expect(
		(await manageLists(repo, "g", "b", { op: "create", name: "行ってみたいお店" }, 1)).text,
	).toContain("すでに");
	await manageLists(repo, "g", "c", { op: "create", name: "行きたい公園", text: "架空公園" }, 1);
	let state = await repo.load("g");
	expect(state.lists).toHaveLength(2);
	const list = state.lists[0];
	if (!list) throw new Error();
	await manageLists(
		repo,
		"g",
		"d",
		{ op: "add", listId: list.id, text: "架空レストラン", note: "テラス席" },
		2,
	);
	await manageLists(
		repo,
		"g",
		"e",
		{ op: "edit", listId: list.id, itemId: "item:d", text: "架空食堂", note: "昼営業" },
		3,
	);
	expect((await manageLists(repo, "g", "read", { op: "show", listId: list.id }, 0)).text).toContain(
		"架空食堂：昼営業",
	);
	await manageLists(repo, "g", "f", { op: "remove", listId: list.id, itemId: "item:d" }, 4);
	await manageLists(repo, "g", "h", { op: "rename", listId: list.id, name: "気になるお店" }, 5);
	state = await repo.load("g");
	expect(state.lists[0]?.aliases).toContain("行きたいお店");
	expect(state.lists[0]?.items).toHaveLength(1);
	expect((await repo.load("other")).lists).toEqual([]);
});
it("requires confirmation and rejects stale deletion, replay and concurrent saves", async () => {
	await manageLists(repo, "g", "create", { op: "create", name: "公園", text: "架空公園" }, 0);
	const state = await repo.load("g");
	const list = state.lists[0];
	if (!list) throw new Error();
	const result = await manageLists(repo, "g", "ask", { op: "delete", listId: list.id }, 1);
	expect(result.confirm).toEqual({ listId: list.id, version: 1 });
	expect((await repo.load("g")).lists).toHaveLength(1);
	const saves = await Promise.all([
		repo.save("g", "change-a", state, state.lists),
		repo.save("g", "change-b", state, state.lists),
	]);
	expect(saves.filter(Boolean)).toHaveLength(1);
	expect(
		(await manageLists(repo, "g", "delete", { op: "delete", listId: list.id }, 1, true)).text,
	).toContain("更新");
	await manageLists(repo, "g", "delete-new", { op: "delete", listId: list.id }, 2, true);
	expect((await repo.load("g")).lists).toEqual([]);
	expect(
		(await manageLists(repo, "g", "create", { op: "create", name: "復活させない" }, 3)).text,
	).toContain("反映済み");
	expect((await repo.load("g")).lists).toEqual([]);
});

it("accepts list deletion only from the confirmation recipient and consumes the button", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const { QuickReplies } = await import("../../src/infrastructure/memory/quick-replies");
	const ns = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	await manageLists(repo, "g", "initial", { op: "create", name: "公園" }, 0);
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		Object.defineProperty(instance, "env", {
			value: { DB: db, LINE_ALLOWED_GROUP_ID: "g", LINE_CHANNEL_ACCESS_TOKEN: "test" },
			configurable: true,
		});
		const button = new QuickReplies(state.storage.sql).issue(
			[
				{
					label: "削除",
					choice: { kind: "collection_delete", listId: "list:initial", version: 1, approve: true },
				},
			],
			"owner",
			Date.now(),
		)[0];
		if (!button) throw new Error();
		const original = globalThis.fetch;
		globalThis.fetch = async () => Response.json({});
		const message = {
			chatType: "group" as const,
			groupId: "g",
			mentioned: false,
			text: "",
			replyToken: "r",
			postback: button.data,
			eventId: "delete",
		};
		try {
			await instance.receive({ ...message, speaker: "other" });
			expect((await repo.load("g")).lists).toHaveLength(1);
			await instance.receive({ ...message, speaker: "owner" });
			expect((await repo.load("g")).lists).toEqual([]);
			await instance.receive({ ...message, speaker: "owner" });
			expect((await repo.load("g")).version).toBe(2);
		} finally {
			globalThis.fetch = original;
		}
	});
});
