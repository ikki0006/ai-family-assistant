import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import previousMigration from "../../migrations/0002_garbage_reminders.sql?raw";
import migration from "../../migrations/0003_reminders.sql?raw";
import memoryMigration from "../../migrations/0005_long_term_memories.sql?raw";
import calendarMigration from "../../migrations/0006_calendar_reminders.sql?raw";
import profileMigration from "../../migrations/0007_family_profiles.sql?raw";
import listMigration from "../../migrations/0008_family_lists.sql?raw";
import { deliverReminder } from "../../src/application/reminders/deliver-reminder";
import { manageReminders } from "../../src/application/reminders/manage-reminders";
import { dispatchReminders } from "../../src/bootstrap/dispatch-reminders";
import { createReminderRepository } from "../../src/infrastructure/persistence/d1/reminders";
const db = (env as unknown as { DB: D1Database }).DB;
const group = `C${"1".repeat(32)}`;
const repo = createReminderRepository(db);
const now = Date.parse("2026-10-04T08:00:00Z");
beforeAll(async () => {
	await (env as unknown as { DB: D1Database }).DB.exec(profileMigration.replace(/\n/g, " "));
	await (env as unknown as { DB: D1Database }).DB.exec(listMigration.replace(/\n/g, " "));
	await db.exec(memoryMigration.replace(/\n/g, " "));
	await db.exec(previousMigration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
	await db.exec(migration.replace(/\n/g, " "));
	await db
		.prepare("INSERT INTO reminders VALUES ('legacy','g','legacy','weekly',1,2,'paused',4,'event')")
		.run();
	await db.prepare("INSERT INTO line_reminder_deliveries VALUES ('legacy-key',1)").run();
	await db.exec(calendarMigration.replace(/\n/g, " "));
	expect(await repo.get("g", "legacy")).toMatchObject({
		kind: "weekly",
		status: "paused",
		version: 4,
		anchor_at: 1,
		next_at: 2,
		interval: 1,
		day: null,
		month: null,
	});
	expect(await repo.wasSent("legacy-key")).toBe(true);
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
					AI: { gateway: () => ({ run: vi.fn() }) },
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
					candidates: [
						{
							finishReason: "STOP",
							content: {
								parts: [
									{ text: JSON.stringify({ action: "create", title: "夕飯", kind: "once", at }) },
								],
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
					AI: { gateway: () => ({ run }) },
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

it("sends the saved action sentence without losing drop-off versus collection intent", async () => {
	const title = "クリーニングを出しに行く時間ですよ。";
	const r = await repo.create(group, "action-sentence", title, { kind: "once", at: now });
	const sender = { push: vi.fn().mockResolvedValue(undefined) };
	await deliverReminder(
		repo,
		sender,
		{ type: "reminder", groupId: group, id: r.id, version: r.version, at: now },
		group,
		now,
	);
	expect(sender.push.mock.calls[0]?.[1]).toBe(`🔔 ${title}`);
});

it("registers monthly rules, delivers, pauses and resumes preserving the requested day", async () => {
	const start = Date.parse("2027-02-01T00:00:00+09:00");
	expect(
		await manageReminders(
			repo,
			group,
			"month",
			{
				action: "create",
				title: "請求書を確認する時間ですよ。",
				kind: "monthly",
				day: 31,
				at: "2027-02-28T08:00:00+09:00",
			},
			start,
		),
	).toContain("毎月");
	const r = await repo.get(group, "month");
	if (!r) throw new Error("Missing reminder");
	const sender = { push: vi.fn().mockResolvedValue(undefined) };
	await deliverReminder(
		repo,
		sender,
		{ type: "reminder", groupId: group, id: r.id, version: r.version, at: r.next_at },
		group,
		r.next_at,
	);
	expect((await repo.get(group, r.id))?.next_at).toBe(Date.parse("2027-03-31T08:00:00+09:00"));
	await manageReminders(
		repo,
		group,
		"pause-month",
		{ action: "pause", id: r.id, version: 2 },
		r.next_at,
	);
	await manageReminders(
		repo,
		group,
		"resume-month",
		{ action: "resume", id: r.id, version: 3 },
		Date.parse("2027-04-01T00:00:00+09:00"),
	);
	expect(await repo.get(group, r.id)).toMatchObject({
		day: 31,
		next_at: Date.parse("2027-04-30T08:00:00+09:00"),
		status: "active",
	});
});
it("lists and edits annual recurrence without losing leap day or interval", async () => {
	const r = await repo.create(group, "annual", "点検する時間ですよ。", {
		kind: "yearly",
		interval: 2,
		month: 2,
		day: 29,
		at: Date.parse("2027-02-28T08:00:00+09:00"),
	});
	expect(await manageReminders(repo, group, "list", { action: "list" }, now)).toContain(
		"2年ごと 2月29日",
	);
	expect(
		await manageReminders(
			repo,
			group,
			"edit",
			{
				action: "update",
				id: r.id,
				version: 1,
				title: "設備を点検する時間ですよ。",
				kind: "yearly",
				at: "2027-02-28T09:00:00+09:00",
			},
			now,
		),
	).toContain("変更しました");
	expect(await repo.get(group, r.id)).toMatchObject({ interval: 2, month: 2, day: 29 });
	expect(
		await manageReminders(
			repo,
			group,
			"invalid",
			{
				action: "create",
				title: "点検",
				kind: "yearly",
				month: 4,
				day: 31,
				at: "2027-04-30T08:00:00+09:00",
			},
			now,
		),
	).toContain("確認");
	expect(await repo.get(group, "invalid")).toBeNull();
});

it("loads collection rules only for the read-only inspect tool and includes them in answers", async () => {
	const { createFamilyProfiles } = await import(
		"../../src/infrastructure/persistence/d1/family-profiles"
	);
	const profiles = createFamilyProfiles(db);
	await profiles.propose(group, {
		speaker: `U${"1".repeat(32)}`,
		names: ["架空太郎"],
		sourceIds: ["intro"],
		occurredAt: 1,
	});
	await profiles.confirm(group, `U${"1".repeat(32)}`, 1);

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
	await db
		.prepare("INSERT OR REPLACE INTO garbage_schedule(id,config_json) VALUES(1,?)")
		.bind(
			JSON.stringify({
				validFrom: "2026-01-01",
				validThrough: "2027-12-31",
				rules: [{ label: "不燃ごみ", weekday: 2, weeks: [1, 3] }],
				overrides: {},
			}),
		)
		.run();
	for (const action of ["none", "inspect"])
		await runInDurableObject(
			namespace.get(namespace.idFromName(crypto.randomUUID())),
			async (instance, state) => {
				const requests: string[] = [];
				const run = vi.fn().mockImplementation(async (input) => {
					requests.push(JSON.stringify(input));
					const text = requests.length === 1 ? JSON.stringify({ action }) : "確認しました。";
					return Response.json({
						candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
					});
				});
				Object.defineProperty(instance, "env", {
					value: {
						DB: db,
						LINE_ALLOWED_GROUP_ID: group,
						LINE_CHANNEL_ACCESS_TOKEN: "test",
						AI: { gateway: () => ({ run }) },
						AI_GATEWAY_ID: "test",
					},
					configurable: true,
				});
				const store = new SessionConversationStore(state.storage.sql, instance.sessions);
				const now = Date.now();
				const ref = await store.append(
					{
						id: "q",
						role: "user",
						speaker: "fictional",
						text: "不燃はいつ？",
						occurredAt: now,
						day: new Date(now).toISOString().slice(0, 10),
					},
					"q",
					now,
				);
				const original = globalThis.fetch;
				globalThis.fetch = async () => Response.json({ sentMessages: [{ id: "answer" }] });
				try {
					await instance.answer({
						eventId: "q",
						groupId: group,
						text: "",
						replyToken: "r",
						receivedAt: now,
						memory: ref ?? { messageId: "q", epoch: -1 },
					});
					expect(requests).toHaveLength(2);
					expect(requests[0]).toContain("架空太郎");
					expect(requests[1]).toContain("架空太郎");
					if (action === "inspect") expect(requests[1]).toContain("不燃ごみ");
					else expect(requests[1]).not.toContain("不燃ごみ");
					expect(await repo.list(group)).toEqual([]);
				} finally {
					globalThis.fetch = original;
				}
			},
		);
});

it("turns contextual improvement intent into buttons without dispatching, but ignores passive proposals", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const { SessionConversationStore } = await import(
		"../../src/infrastructure/memory/session-conversation-store"
	);
	const ns = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	const improvementMigration = await import("../../migrations/0004_improvements.sql?raw");
	await db.exec(improvementMigration.default.replace(/\n/g, " "));
	for (const passive of [false, true])
		await runInDurableObject(
			ns.get(ns.idFromName(crypto.randomUUID())),
			async (instance, state) => {
				const run = vi.fn(async () =>
					Response.json({
						candidates: [
							{
								finishReason: "STOP",
								content: {
									parts: [
										{
											text: JSON.stringify({
												action: "improve",
												specification: "通知の確認を短いボタンで回答できるようにする",
											}),
										},
									],
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
						GH_IMPROVEMENT_TOKEN: "test",
						AI: { gateway: () => ({ run }) },
						AI_GATEWAY_ID: "test",
					},
					configurable: true,
				});
				const store = new SessionConversationStore(state.storage.sql, instance.sessions);
				const at = Date.now();
				const append = (id: string, text: string) =>
					store.append(
						{
							id,
							role: "user",
							speaker: "fictional",
							text,
							occurredAt: at,
							day: new Date(at).toISOString().slice(0, 10),
						},
						id,
						at,
					);
				await append("prior", "確認を選択肢で返せると便利だね");
				const ref = await append("request", "それ作れる？");
				if (!ref) throw new Error("missing reference");
				const original = globalThis.fetch;
				const sent: string[] = [];
				globalThis.fetch = async (url, init) => {
					expect(String(url)).toContain("api.line.me");
					sent.push(String(init?.body));
					return Response.json({});
				};
				try {
					await instance.answer({
						eventId: `context-${passive}`,
						groupId: group,
						text: "",
						replyToken: "r",
						receivedAt: at,
						memory: ref,
						passive,
					});
					expect(JSON.stringify(run.mock.calls)).toContain("それ作れる？");
					if (passive) expect(sent).toHaveLength(0);
					else {
						expect(sent).toHaveLength(1);
						expect(sent[0]).toContain("承認してPR作成");
						expect(sent[0]).toContain("通知の確認を短いボタン");
					}
				} finally {
					globalThis.fetch = original;
				}
			},
		);
});

it("executes shared list requests through the conversation planner without creating reminders", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const { SessionConversationStore } = await import(
		"../../src/infrastructure/memory/session-conversation-store"
	);
	const { createFamilyLists } = await import(
		"../../src/infrastructure/persistence/d1/family-lists"
	);
	const ns = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const run = vi.fn(async () =>
			Response.json({
				candidates: [
					{
						finishReason: "STOP",
						content: {
							parts: [
								{
									text: JSON.stringify({
										action: "collection",
										collection: { op: "create", name: "行きたい公園", text: "架空公園" },
									}),
								},
							],
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
				AI: { gateway: () => ({ run }) },
				AI_GATEWAY_ID: "test",
			},
			configurable: true,
		});
		const store = new SessionConversationStore(state.storage.sql, instance.sessions);
		const now = Date.now();
		const ref = await store.append(
			{
				id: "list-request",
				role: "user",
				speaker: "fictional",
				text: "行きたい公園リストに架空公園を入れて",
				occurredAt: now,
				day: new Date(now).toISOString().slice(0, 10),
			},
			"list-request",
			now,
		);
		if (!ref) throw new Error();
		const original = globalThis.fetch;
		const sent: string[] = [];
		globalThis.fetch = async (_url, init) => {
			sent.push(String(init?.body));
			return Response.json({});
		};
		try {
			await instance.answer({
				eventId: "list-request",
				groupId: group,
				text: "",
				replyToken: "r",
				receivedAt: now,
				memory: ref,
			});
		} finally {
			globalThis.fetch = original;
		}
		expect(sent[0]).toContain("追加しました");
		expect((await createFamilyLists(db).load(group)).lists[0]?.items[0]?.text).toBe("架空公園");
		expect(await repo.list(group)).toEqual([]);
	});
});
