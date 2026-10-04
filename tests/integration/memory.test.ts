import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import {
	RETENTION_MS,
	SessionConversationStore,
} from "../../src/infrastructure/memory/session-conversation-store";
const namespace = (
	env as unknown as { CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent> }
).CONVERSATIONS;
const now = Date.parse("2026-10-04T02:00:00Z");
function message(id: string, at = now, text = "明日はカレー") {
	return {
		id,
		role: "user" as const,
		text,
		speaker: "fictional-person",
		occurredAt: at,
		day: new Date(at + 9 * 3600000).toISOString().slice(0, 10),
	};
}
function stub() {
	return namespace.get(namespace.idFromName(crypto.randomUUID()));
}
it("persists ordinary conversation in Sessions and deduplicates redelivered events", async () => {
	const actor = stub();
	await runInDurableObject(actor, async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const ref = await store.append(message("a"), "event-a", now);
		expect(await store.append(message("a"), "event-a", now)).toEqual(ref);
	});
	await runInDurableObject(actor, async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const ref = await store.append(
			message("b", now + 1000, "明日の献立は？"),
			"event-b",
			now + 1000,
		);
		expect(ref).not.toBeNull();
		const snapshot = await store.snapshot(ref ?? { messageId: "missing", epoch: -1 }, now + 1000);
		expect(snapshot?.messages.map((m) => m.text)).toEqual(["明日はカレー", "明日の献立は？"]);
	});
});
it("unsend invalidates summaries and stale generations, and blocks resurrection", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const ref = await store.append(message("a"), "event-a", now);
		const snapshot = await store.snapshot(ref ?? { messageId: "missing", epoch: -1 }, now);
		await store.saveSummary("2026-10-04", "old private fact", now, snapshot?.revision ?? -1);
		await store.forget("a", now + 1);
		expect(await store.snapshot(ref ?? { messageId: "missing", epoch: -1 }, now + 1)).toBeNull();
		expect(await store.append(message("a"), "event-a", now + 2)).toBeNull();
		expect(
			await store.saveSummary("2026-10-04", "old private fact", now, snapshot?.revision ?? -1),
		).toBe(false);
		expect(state.storage.sql.exec("SELECT * FROM family_summaries").toArray()).toEqual([]);
	});
});
it("reset clears raw history, invalidates queued references and is idempotent", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const ref = await store.append(message("a"), "a", now);
		await store.reset("reset", now + 1, now + 1);
		expect(await store.snapshot(ref ?? { messageId: "missing", epoch: -1 }, now + 2)).toBeNull();
		expect(await instance.sessions.session("2026-10-04").getMessage("a")).toBeNull();
		expect(await store.append(message("late", now), "late", now + 2)).toBeNull();
		const next = await store.append(message("b", now + 3), "b", now + 3);
		await store.reset("reset", now + 1, now + 4);
		expect(
			(await store.snapshot(next ?? { messageId: "missing", epoch: -1 }, now + 4))?.messages,
		).toHaveLength(1);
	});
});
it("expires raw messages and derived summaries after seven days", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const ref = await store.append(message("a"), "a", now);
		await store.saveSummary("2026-10-04", "summary", now, store.meta().revision);
		await store.prune(now + RETENTION_MS + 1);
		expect(
			await store.snapshot(ref ?? { messageId: "missing", epoch: -1 }, now + RETENTION_MS + 1),
		).toBeNull();
		expect(await instance.sessions.session("2026-10-04").getMessage("a")).toBeNull();
		expect(state.storage.sql.exec("SELECT * FROM family_summaries").toArray()).toEqual([]);
	});
});
it("isolates storage across family objects", async () => {
	const a = stub();
	const b = stub();
	await runInDurableObject(a, async (instance, state) => {
		await new SessionConversationStore(state.storage.sql, instance.sessions).append(
			message("a"),
			"a",
			now,
		);
	});
	await runInDurableObject(b, async (instance, state) => {
		expect(
			await new SessionConversationStore(state.storage.sql, instance.sessions).snapshot(
				{ messageId: "a", epoch: 0 },
				now,
			),
		).toBeNull();
	});
});

it("passes saved conversation to AI and records only a successfully delivered answer", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const time = Date.now();
		await store.append(message("meal", time - 1000), "meal", time);
		const reference = await store.append(
			message("question", time, "明日の献立は？"),
			"question",
			time,
		);
		let modelInput = "";
		Object.defineProperty(instance, "env", {
			value: {
				LINE_ALLOWED_GROUP_ID: "family",
				LINE_CHANNEL_ACCESS_TOKEN: "test-token",
				AI_GATEWAY_ID: "test-gateway",
				AI: {
					gateway: () => ({
						run: async (input: unknown) => {
							modelInput = JSON.stringify(input);
							return Response.json({
								candidates: [
									{ finishReason: "STOP", content: { parts: [{ text: "明日はカレーです。" }] } },
								],
							});
						},
					}),
				},
			},
			configurable: true,
		});
		const originalFetch = globalThis.fetch;
		let sends = 0;
		globalThis.fetch = async () => {
			sends++;
			return Response.json({});
		};
		try {
			await instance.answer({
				eventId: "question",
				groupId: "family",
				text: "",
				replyToken: "test-reply",
				receivedAt: time,
				memory: reference ?? { messageId: "missing", epoch: -1 },
			});
			expect(modelInput).toContain("明日はカレー");
			expect(modelInput).toContain("明日の献立は？");
			expect(sends).toBe(1);
			const row = state.storage.sql
				.exec<{ id: string }>("SELECT id FROM family_messages WHERE role='assistant'")
				.one();
			expect(row.id).toBe("answer:question");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

it("drops an in-flight answer if an unsend invalidates its context", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const time = Date.now();
		const reference = await store.append(message("question", time), "question", time);
		let started: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		let finish: (response: Response) => void = () => {};
		const result = new Promise<Response>((resolve) => {
			finish = resolve;
		});
		Object.defineProperty(instance, "env", {
			value: {
				LINE_ALLOWED_GROUP_ID: "family",
				LINE_CHANNEL_ACCESS_TOKEN: "test-token",
				AI_GATEWAY_ID: "test",
				AI: {
					gateway: () => ({
						run: async () => {
							started();
							return result;
						},
					}),
				},
			},
			configurable: true,
		});
		const originalFetch = globalThis.fetch;
		let sends = 0;
		globalThis.fetch = async () => {
			sends++;
			return Response.json({});
		};
		try {
			const pending = instance.answer({
				eventId: "question",
				groupId: "family",
				text: "",
				replyToken: "reply",
				receivedAt: time,
				memory: reference ?? { messageId: "missing", epoch: -1 },
			});
			await entered;
			await instance.receive({
				chatType: "group",
				groupId: "family",
				mentioned: false,
				unsend: true,
				messageId: "question",
				text: "",
				replyToken: "",
			});
			finish(
				Response.json({
					candidates: [
						{ finishReason: "STOP", content: { parts: [{ text: "deleted information" }] } },
					],
				}),
			);
			await pending;
			expect(sends).toBe(0);
			expect(state.storage.sql.exec("SELECT id FROM family_messages").toArray()).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

it("recovers a deletion interrupted after recording its tombstone", async () => {
	await runInDurableObject(stub(), async (instance, state) => {
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		await store.append(message("a"), "a", now);
		await store.append({ ...message("derived", now + 1), role: "assistant" }, "derived", now + 1);
		// Simulate interruption before the asynchronous Sessions deletes complete.
		state.storage.sql.exec("INSERT INTO family_tombstones VALUES (?,?)", "a", now + 2);
		await store.prune(now + 3);
		expect(await instance.sessions.session("2026-10-04").getMessage("a")).toBeNull();
		expect(await instance.sessions.session("2026-10-04").getMessage("derived")).toBeNull();
	});
});
