import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import previousMigration from "../../migrations/0002_garbage_reminders.sql?raw";
import migration from "../../migrations/0003_reminders.sql?raw";
import { deliverReminder } from "../../src/application/reminders/deliver-reminder";
import { manageReminders } from "../../src/application/reminders/manage-reminders";
import { dispatchReminders } from "../../src/bootstrap/dispatch-reminders";
import { createReminderRepository } from "../../src/infrastructure/persistence/d1/reminders";
const db = (env as unknown as { DB: D1Database }).DB;
const group = `C${"1".repeat(32)}`;
const repo = createReminderRepository(db);
const now = Date.parse("2026-10-04T08:00:00Z");
beforeAll(async () => {
	await db.exec(previousMigration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
	await db.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM reminders"),
		db.prepare("DELETE FROM line_reminder_deliveries"),
	]);
});
async function create(kind: "once" | "daily" | "weekly" = "once") {
	return repo.create(group, "fictional-event", "夕飯", { kind, at: now + 3600000 });
}
it("creates idempotently, lists, rejects past dates and isolates groups", async () => {
	const action = {
		action: "create" as const,
		title: "夕飯",
		kind: "once" as const,
		at: "2026-10-04T18:00:00+09:00",
	};
	expect(await manageReminders(repo, group, "fictional-event", action, now)).toContain(
		"登録しました",
	);
	await manageReminders(repo, group, "fictional-event", action, now);
	expect(await repo.list(group)).toHaveLength(1);
	expect(await repo.list("other")).toEqual([]);
	expect(await manageReminders(repo, group, "past", action, now + 7200000)).toContain("未来");
});
it("pause invalidates queued jobs and resume skips past repeating times", async () => {
	const r = await create("daily");
	const sender = { push: vi.fn() };
	await manageReminders(repo, group, "pause", { action: "pause", id: r.id, version: 1 }, now);
	await deliverReminder(
		repo,
		sender,
		{ type: "reminder", groupId: group, id: r.id, version: 1, at: r.next_at },
		group,
		r.next_at,
	);
	expect(sender.push).not.toHaveBeenCalled();
	await manageReminders(
		repo,
		group,
		"resume",
		{ action: "resume", id: r.id, version: 2 },
		r.next_at + 1,
	);
	expect((await repo.get(group, r.id))?.next_at).toBe(r.next_at + 86400000);
});
it("version checks prevent stale edits and deletion clears the title", async () => {
	const r = await create();
	await manageReminders(repo, group, "pause", { action: "pause", id: r.id, version: 1 }, now);
	expect(
		await manageReminders(
			repo,
			group,
			"delete-old",
			{ action: "delete", id: r.id, version: 1 },
			now,
		),
	).toContain("状態が変わりました");
	await manageReminders(repo, group, "delete", { action: "delete", id: r.id, version: 2 }, now);
	expect(await repo.list(group)).toEqual([]);
	expect((await repo.get(group, r.id))?.title).toBe("");
});
it("retries with the same key then advances only after successful delivery", async () => {
	const r = await create("weekly");
	const sender = {
		push: vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined),
	};
	const job = { type: "reminder" as const, groupId: group, id: r.id, version: 1, at: r.next_at };
	await expect(deliverReminder(repo, sender, job, group, r.next_at)).rejects.toThrow();
	expect((await repo.get(group, r.id))?.version).toBe(1);
	await deliverReminder(repo, sender, job, group, r.next_at + 300000);
	await deliverReminder(repo, sender, job, group, r.next_at + 300000);
	expect(sender.push).toHaveBeenCalledTimes(2);
	expect(sender.push.mock.calls[0]?.[2]).toBe(sender.push.mock.calls[1]?.[2]);
	expect((await repo.get(group, r.id))?.next_at).toBe(r.next_at + 7 * 86400000);
});
it("skips stale notifications beyond the retry window and completes one-shot", async () => {
	const r = await create();
	const sender = { push: vi.fn() };
	await deliverReminder(
		repo,
		sender,
		{ type: "reminder", groupId: group, id: r.id, version: 1, at: r.next_at },
		group,
		r.next_at + 24 * 3600000,
	);
	expect(sender.push).not.toHaveBeenCalled();
	expect((await repo.get(group, r.id))?.status).toBe("done");
});
it("dispatches only due active reminders without conversation content", async () => {
	const r = await create();
	const sendBatch = vi.fn();
	const bindings = {
		DB: db,
		LINE_ALLOWED_GROUP_ID: group,
		JOBS_QUEUE: { sendBatch } as unknown as Queue,
	};
	await dispatchReminders(now, bindings);
	expect(sendBatch).not.toHaveBeenCalled();
	await dispatchReminders(r.next_at, bindings);
	expect(sendBatch).toHaveBeenCalledWith([
		{ body: { type: "reminder", groupId: group, id: r.id, version: 1, at: r.next_at } },
	]);
});

it("responds to bot quotes, ignores human quotes, and queues relevant unmentioned text", async () => {
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
		async (instance, state) => {
			const send = vi.fn();
			Object.defineProperty(instance, "env", {
				value: {
					LINE_ALLOWED_GROUP_ID: group,
					LINE_CHANNEL_ACCESS_TOKEN: "test",
					AI: { run: vi.fn() },
					AI_GATEWAY_ID: "test",
					JOBS_QUEUE: { send },
				},
				configurable: true,
			});
			await instance.recordSent("bot-id", "通知を登録しますか？");
			const base = {
				chatType: "group" as const,
				groupId: group,
				mentioned: false,
				text: "お願い",
				replyToken: "reply",
			};
			await instance.receive({
				...base,
				eventId: "a",
				messageId: "a",
				occurredAt: Date.now(),
				quotedMessageId: "human-id",
			});
			expect(send).not.toHaveBeenCalled();
			await instance.receive({
				...base,
				eventId: "b",
				messageId: "b",
				occurredAt: Date.now(),
				quotedMessageId: "bot-id",
			});
			expect(send.mock.calls[0]?.[0]).toMatchObject({ quotedMessageId: "bot-id", text: "" });
			await instance.receive({
				...base,
				eventId: "c",
				messageId: "c",
				occurredAt: Date.now(),
				text: "明日が提出期限だった",
			});
			expect(send.mock.calls[1]?.[0]).toMatchObject({ passive: true, text: "" });
			expect(state.storage.sql.exec("SELECT * FROM family_messages").toArray()).toHaveLength(3);
		},
	);
});
it("executes a model plan before confirming and prevents passive implicit creation", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const { SessionConversationStore } = await import(
		"../../src/infrastructure/memory/session-conversation-store"
	);
	const namespace = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	await runInDurableObject(
		namespace.get(namespace.idFromName(crypto.randomUUID())),
		async (instance, state) => {
			const time = Date.now();
			const at = `${new Date(time + 3600000 + 9 * 3600000).toISOString().slice(0, 16)}:00+09:00`;
			const run = vi.fn().mockImplementation(async () =>
				Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({ action: "create", title: "夕飯", kind: "once", at }),
							},
						},
					],
				}),
			);
			Object.defineProperty(instance, "env", {
				value: {
					DB: db,
					LINE_ALLOWED_GROUP_ID: group,
					LINE_CHANNEL_ACCESS_TOKEN: "test",
					AI: { run },
					AI_GATEWAY_ID: "test",
				},
				configurable: true,
			});
			const store = new SessionConversationStore(state.storage.sql, instance.sessions);
			const original = globalThis.fetch;
			const sent: string[] = [];
			globalThis.fetch = async (_url, init) => {
				sent.push(String(init?.body));
				return Response.json({ sentMessages: [{ id: "sent-bot-id" }] });
			};
			try {
				for (const [id, text] of [
					["implicit", "明日は夕飯どうしよう"],
					["explicit", "1時間後に夕飯をリマインドして"],
				] as const) {
					const current = Date.now();
					const ref = await store.append(
						{
							id,
							role: "user",
							text,
							speaker: "fictional",
							occurredAt: current,
							day: new Date(current + 9 * 3600000).toISOString().slice(0, 10),
						},
						id,
						current,
					);
					await instance.answer({
						eventId: id,
						groupId: group,
						text: "",
						replyToken: "reply",
						receivedAt: current,
						passive: true,
						memory: ref ?? { messageId: "missing", epoch: -1 },
					});
					if (id === "implicit") expect(await repo.list(group)).toEqual([]);
				}
				expect(await repo.list(group)).toHaveLength(1);
				expect(sent[0]).toContain("登録しますか");
				expect(sent[1]).toContain("登録しました");
				expect(store.outgoing("sent-bot-id", Date.now())).toContain("登録しました");
			} finally {
				globalThis.fetch = original;
			}
		},
	);
});
