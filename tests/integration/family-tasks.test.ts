import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import reminders from "../../migrations/0003_reminders.sql?raw";
import calendar from "../../migrations/0006_calendar_reminders.sql?raw";
import profilesMigration from "../../migrations/0007_family_profiles.sql?raw";
import migration from "../../migrations/0009_family_tasks.sql?raw";
import type { GenerationJob } from "../../src/application/ports/generation-queue";
import { manageTasks } from "../../src/application/tasks/manage-tasks";
import { dispatchReminders } from "../../src/bootstrap/dispatch-reminders";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import { processGenerationBatch } from "../../src/bootstrap/process-generation-batch";
import { createFamilyTasks } from "../../src/infrastructure/persistence/d1/family-tasks";
const db = (env as unknown as { DB: D1Database }).DB;
const ns = (env as unknown as { CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent> })
	.CONVERSATIONS;
const repo = createFamilyTasks(db);
const group = `C${"1".repeat(32)}`;
const A = `U${"1".repeat(32)}`;
const B = `U${"2".repeat(32)}`;
const profiles = [A, B].map((speaker, i) => ({
	speaker,
	names: [i ? "架空B" : "架空A"],
	pending: [],
	sourceIds: [],
	version: 1,
}));
const at = Date.parse("2026-10-27T18:00:00+09:00");
beforeAll(async () => {
	for (const m of [migration, reminders, calendar, profilesMigration])
		await db.exec(m.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM family_task_state"),
		db.prepare("DELETE FROM family_task_events"),
		db.prepare("DELETE FROM family_profiles"),
	]);
});
async function create() {
	await manageTasks(
		repo,
		group,
		"create",
		{
			op: "create",
			title: "銀行振込",
			assignees: [A, B],
			kind: "monthly",
			day: 27,
			at: "2026-10-27T18:00:00+09:00",
		},
		A,
		profiles,
		at - 1,
	);
}
it("uses group isolation and atomic compare/update with event receipts", async () => {
	await create();
	const state = await repo.load(group);
	expect((await repo.load("other")).tasks).toEqual([]);
	const outcomes = await Promise.all([
		repo.save(group, "x", state, state.tasks),
		repo.save(group, "y", state, state.tasks),
	]);
	expect(outcomes.filter(Boolean)).toHaveLength(1);
	expect(await repo.applied(group, "create")).toBe(true);
	expect(await repo.save(group, "create", await repo.load(group), [])).toBe(false);
});
it("dispatches only due work and routes task jobs to the allowed group", async () => {
	const send = vi.fn();
	const sendBatch = vi.fn();
	const jobs = { send, sendBatch } as unknown as Queue;
	await create();
	await dispatchReminders(at - 1, { DB: db, JOBS_QUEUE: jobs, LINE_ALLOWED_GROUP_ID: group });
	expect(send).not.toHaveBeenCalled();
	await dispatchReminders(at, { DB: db, JOBS_QUEUE: jobs, LINE_ALLOWED_GROUP_ID: group });
	expect(send).toHaveBeenCalledWith({ type: "tasks", groupId: group });
	const deliverTasks = vi.fn();
	const ack = vi.fn();
	const retry = vi.fn();
	const conversations = { idFromName: vi.fn(), get: () => ({ deliverTasks }) };
	await processGenerationBatch(
		{
			messages: [
				{ body: { type: "tasks", groupId: group }, ack, retry },
				{ body: { type: "tasks", groupId: "other" }, ack, retry },
			],
		} as unknown as MessageBatch<unknown>,
		{ LINE_ALLOWED_GROUP_ID: group, CONVERSATIONS: conversations as never },
	);
	expect(deliverTasks).toHaveBeenCalledTimes(1);
	expect(ack).toHaveBeenCalledTimes(2);
	expect(retry).not.toHaveBeenCalled();
});
it("routes natural requests into tasks without creating reminders, and keeps completion buttons independent", async () => {
	for (const p of profiles)
		await db
			.prepare("INSERT INTO family_profiles(group_id,speaker,names_json) VALUES(?,?,?)")
			.bind(group, p.speaker, JSON.stringify(p.names))
			.run();
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance) => {
		const future = Date.now() + 3600000;
		const atString = new Date(future + 9 * 3600000)
			.toISOString()
			.replace("Z", "+09:00")
			.replace(/:\d\d\.\d{3}\+/, ":00+");
		const run = vi.fn(async () =>
			Response.json({
				candidates: [
					{
						finishReason: "STOP",
						content: {
							parts: [
								{
									text: JSON.stringify({
										action: "task",
										task: {
											op: "create",
											title: "銀行振込",
											assignees: [A, B],
											kind: "once",
											at: atString,
										},
									}),
								},
							],
						},
					},
				],
			}),
		);
		const jobs: GenerationJob[] = [];
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				DB: db,
				LINE_ALLOWED_GROUP_ID: group,
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				AI: { gateway: () => ({ run }) },
				AI_GATEWAY_ID: "test",
				JOBS_QUEUE: {
					send: async (j: GenerationJob) => {
						jobs.push(j);
					},
				},
			},
		});
		const original = globalThis.fetch;
		const sent: Record<string, unknown>[] = [];
		globalThis.fetch = async (_url, init) => {
			sent.push(JSON.parse(String(init?.body)));
			return Response.json({ sentMessages: [{ id: crypto.randomUUID() }] });
		};
		try {
			const incoming = {
				chatType: "group" as const,
				groupId: group,
				speaker: A,
				mentioned: true,
				text: "AとBの振込タスクを作って",
				replyToken: "r",
				eventId: "natural",
				messageId: "natural",
				occurredAt: Date.now(),
			};
			await instance.receive(incoming);
			await instance.answer(jobs[0] as GenerationJob);
			let state = await repo.load(group);
			expect(state.tasks).toHaveLength(1);
			expect(await db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
			// Move this fictional occurrence to an elapsed deadline, without waiting or sending real messages.
			const task = state.tasks[0];
			if (!task) throw new Error();
			task.schedule.at = Date.now() - 1000;
			for (const o of task.occurrences) o.dueAt = task.schedule.at;
			await repo.save(group, "test-due", state, state.tasks);
			await instance.deliverTasks();
			const payload = sent.at(-1) as {
				messages: { quickReply: { items: { action: { data: string } }[] } }[];
			};
			const buttons = payload.messages[0]?.quickReply.items;
			if (!buttons?.[0] || !buttons[1]) throw new Error();
			const response = (owner: string, event: string, data: string) =>
				instance.receive({
					...incoming,
					speaker: owner,
					mentioned: false,
					text: "",
					eventId: event,
					messageId: `postback:${event}`,
					postback: data,
				});
			await response(B, "wrong", buttons[0].action.data);
			expect(
				(await repo.load(group)).tasks[0]?.occurrences.filter((o) => o.doneAt !== null),
			).toHaveLength(0);
			await response(A, "done-a", buttons[0].action.data);
			await response(B, "done-b", buttons[1].action.data);
			state = await repo.load(group);
			expect(state.tasks[0]?.occurrences.every((o) => o.doneAt !== null)).toBe(true);
			expect(run).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.fetch = original;
		}
	});
});
