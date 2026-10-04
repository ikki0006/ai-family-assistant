import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import migration from "../../migrations/0005_long_term_memories.sql?raw";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import {
	RETENTION_MS,
	SessionConversationStore,
} from "../../src/infrastructure/memory/session-conversation-store";
import { createLongTermMemory } from "../../src/infrastructure/persistence/d1/long-term-memory";
const bindings = env as unknown as {
	DB: D1Database;
	CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent>;
};
const repo = createLongTermMemory(bindings.DB);
const now = Date.now();
function actor() {
	return bindings.CONVERSATIONS.get(bindings.CONVERSATIONS.idFromName(crypto.randomUUID()));
}
function message(id: string, at = now - 20 * 60000) {
	return {
		id,
		role: "user" as const,
		speaker: "fictional-person",
		text: "好みはカレー",
		occurredAt: at,
		day: new Date(at + 9 * 3600000).toISOString().slice(0, 10),
	};
}
beforeAll(async () => {
	await bindings.DB.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
	await bindings.DB.prepare("DELETE FROM long_term_memories").run();
});
it("isolates families, replaces facts idempotently, preserves provenance and expires facts", async () => {
	const fact = {
		subject: "person",
		key: "preference",
		text: "カレー",
		sourceIds: ["m1"],
		expiresAt: null,
	};
	await repo.apply("g", [fact], [], now);
	await repo.apply("g", [{ ...fact, text: "シチュー", sourceIds: ["m2"] }], [], now + 1);
	expect(await repo.list("other", now + 1)).toEqual([]);
	const rows = await repo.list("g", now + 1);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.sourceIds).toEqual(["m1", "m2"]);
	await repo.removeSources("g", ["m1"]);
	expect(await repo.list("g", now + 1)).toEqual([]);
	await repo.apply("g", [{ ...fact, expiresAt: now + 100 }], [], now);
	expect(await repo.list("g", now + 101)).toEqual([]);
});
it("waits for quiet or one hour, leases one job, processes only new messages, keeps long-term across raw retention", async () => {
	await runInDurableObject(actor(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		await store.append(message("m", now - 60000), "m", now);
		expect(store.claimMemory(now)).toBeNull();
		const token = store.claimMemory(now + 15 * 60000);
		expect(token).not.toBeNull();
		expect(store.claimMemory(now + 15 * 60000)).toBeNull();
		const batch = await store.memoryBatch(token ?? "", now + 15 * 60000);
		expect(batch?.messages.map((m) => m.id)).toEqual(["m"]);
		if (!batch) throw new Error("Missing batch");
		await store.completeMemory(batch, "summary");
		store.releaseMemory(token ?? "");
		expect(store.claimMemory(now + 16 * 60000)).toBeNull();
		await repo.apply(
			"g",
			[{ subject: "person", key: "food", text: "カレー", sourceIds: ["m"], expiresAt: null }],
			[],
			now,
		);
		await store.prune(now + RETENTION_MS + 1);
		expect(await repo.list("g", now + RETENTION_MS + 1)).toHaveLength(1);
	});
});
it("does not hold the conversation lock while organizing and drops an unsent-source result", async () => {
	await runInDurableObject(actor(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		await store.append(message("m"), "m", now);
		const token = store.claimMemory(now);
		if (!token) throw new Error("Missing lease");
		let entered: () => void = () => {};
		const started = new Promise<void>((r) => {
			entered = r;
		});
		let resolve: (r: Response) => void = () => {};
		const pending = new Promise<Response>((r) => {
			resolve = r;
		});
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				DB: bindings.DB,
				LINE_ALLOWED_GROUP_ID: "g",
				AI_GATEWAY_ID: "test",
				AI: {
					gateway: () => ({
						run: async () => {
							entered();
							return pending;
						},
					}),
				},
			},
		});
		const work = instance.organize(token);
		await started;
		await instance.receive({
			chatType: "group",
			groupId: "g",
			mentioned: false,
			unsend: true,
			messageId: "m",
			text: "",
			replyToken: "",
		});
		resolve(
			Response.json({
				candidates: [
					{
						finishReason: "STOP",
						content: {
							parts: [
								{
									text: JSON.stringify({
										summary: "消去された内容",
										updates: [
											{
												subject: "fictional-person",
												key: "food",
												text: "カレー",
												sourceIds: ["m"],
												expiresAt: null,
											},
										],
										retire: [],
									}),
								},
							],
						},
					},
				],
			}),
		);
		await work;
		expect(await repo.list("g", Date.now())).toEqual([]);
		expect(state.storage.sql.exec("SELECT * FROM family_summaries").toArray()).toEqual([]);
	});
});
it("writes async summaries/facts once, rejects duplicate work, and invalidates on reset", async () => {
	await runInDurableObject(actor(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		await store.append(message("m"), "m", now);
		const token = store.claimMemory(now);
		if (!token) throw new Error("Missing lease");
		let calls = 0;
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				DB: bindings.DB,
				LINE_ALLOWED_GROUP_ID: "g",
				AI_GATEWAY_ID: "test",
				AI: {
					gateway: () => ({
						run: async () => {
							calls++;
							return Response.json({
								candidates: [
									{
										finishReason: "STOP",
										content: {
											parts: [
												{
													text: JSON.stringify({
														summary: "好みの話",
														updates: [
															{
																subject: "fictional-person",
																key: "food",
																text: "カレーが好き",
																sourceIds: ["m"],
																expiresAt: null,
															},
														],
														retire: [],
													}),
												},
											],
										},
									},
								],
							});
						},
					}),
				},
			},
		});
		await Promise.all([instance.organize(token), instance.organize(token)]);
		await instance.organize(token);
		expect(calls).toBe(1);
		expect(await repo.list("g", now)).toHaveLength(1);
		expect(state.storage.sql.exec("SELECT * FROM family_summaries").toArray()).toHaveLength(1);
		await store.reset("reset", now + 1, now + 1);
		await instance.scheduleMemory(now + 2);
		// Missing Queue should not perform work; deletion is durably recorded until next valid request.
		expect(store.pendingMemoryDeletions()).toContain("*");
	});
});

it("serves memory inventory and explicit save/delete from persisted data without AI", async () => {
	await runInDurableObject(actor(), async (instance, state) => {
		let modelCalls = 0;
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				DB: bindings.DB,
				LINE_ALLOWED_GROUP_ID: "g",
				LINE_CHANNEL_ACCESS_TOKEN: "test-token",
				AI_GATEWAY_ID: "test",
				AI: {
					gateway: () => ({
						run: async () => {
							modelCalls++;
							throw new Error("Should not call AI");
						},
					}),
				},
			},
		});
		const responses: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = async (_input, init) => {
			responses.push(
				(JSON.parse(String(init?.body)) as { messages: { text: string }[] }).messages[0]?.text ??
					"",
			);
			return Response.json({});
		};
		const base = {
			chatType: "group" as const,
			groupId: "g",
			mentioned: true,
			speaker: "fictional-person",
			replyToken: "test-reply",
		};
		try {
			const time = Date.now();
			await instance.receive({
				...base,
				eventId: "save",
				messageId: "save",
				occurredAt: time,
				text: "覚えて: 朝は紅茶が好き",
			});
			expect(responses.at(-1)).toContain("覚えました");
			await instance.receive({
				...base,
				eventId: "list",
				messageId: "list",
				occurredAt: time + 1,
				text: "何を覚えてる？",
			});
			expect(responses.at(-1)).toContain("朝は紅茶が好き");
			const fact = (await repo.list("g", time))[0];
			if (!fact) throw new Error("Missing fact");
			await instance.receive({
				...base,
				eventId: "delete",
				messageId: "delete",
				occurredAt: time + 2,
				text: `記憶削除 ${fact.id}`,
			});
			expect(await repo.list("g", time + 2)).toEqual([]);
			expect(
				state.storage.sql.exec("SELECT id FROM family_messages WHERE id='save'").toArray(),
			).toEqual([]);
			expect(modelCalls).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});
