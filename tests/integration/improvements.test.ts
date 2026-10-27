import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import reminderMigration from "../../migrations/0003_reminders.sql?raw";
import migration from "../../migrations/0004_improvements.sql?raw";
import calendarMigration from "../../migrations/0006_calendar_reminders.sql?raw";
import profileMigration from "../../migrations/0007_family_profiles.sql?raw";
import listMigration from "../../migrations/0008_family_lists.sql?raw";
import type { GenerationJob } from "../../src/application/ports/generation-queue";
import { createImprovementRepository } from "../../src/infrastructure/persistence/d1/improvement-repository";

const db = (env as unknown as { DB: D1Database }).DB;
const repository = createImprovementRepository(db);
beforeAll(async () => {
	await (env as unknown as { DB: D1Database }).DB.exec(profileMigration.replace(/\n/g, " "));
	await (env as unknown as { DB: D1Database }).DB.exec(listMigration.replace(/\n/g, " "));
	await db.exec(reminderMigration.replace(/\n/g, " "));
	await db.exec(calendarMigration.replace(/\n/g, " "));
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

it("approves a displayed proposal by postback once, and cancellation prevents approval", async () => {
	const { runInDurableObject } = await import("cloudflare:test");
	const { QuickReplies } = await import("../../src/infrastructure/memory/quick-replies");
	const ns = (
		env as unknown as {
			CONVERSATIONS: DurableObjectNamespace<
				import("../../src/bootstrap/family-conversation-agent").FamilyConversationAgent
			>;
		}
	).CONVERSATIONS;
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const jobs: GenerationJob[] = [];
		let aiCalls = 0;
		Object.defineProperty(instance, "env", {
			value: {
				DB: db,
				LINE_ALLOWED_GROUP_ID: "group",
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				GH_IMPROVEMENT_TOKEN: "test",
				JOBS_QUEUE: {
					send: async (job: GenerationJob) => {
						jobs.push(job);
					},
				},
				AI_GATEWAY_ID: "test",
				AI: {
					gateway: () => ({
						run: async () =>
							Response.json({
								candidates: [
									{
										finishReason: "STOP",
										content: {
											parts: [
												{
													text: JSON.stringify(
														++aiCalls % 3 === 2
															? ["src/application/prompts/reminders.ts"]
															: { action: "improve", specification: "回答を短くしてください" },
													),
												},
											],
										},
									},
								],
							}),
					}),
				},
			},
			configurable: true,
		});
		const original = globalThis.fetch;
		const messages: Array<{
			text: string;
			quickReply?: { items: Array<{ action: { data: string } }> };
		}> = [];
		let dispatched = 0;
		globalThis.fetch = async (url, init) => {
			if (String(url).startsWith("https://api.github.com/") && init?.method === "GET") {
				if (String(url).endsWith("commits/main")) return Response.json({ sha: "a".repeat(40) });
				if (String(url).includes("git/trees/"))
					return Response.json({
						tree: [{ path: "src/application/prompts/reminders.ts", mode: "100644", type: "blob" }],
					});
				return new Response("reference source");
			}
			if (String(url).startsWith("https://api.github.com/")) {
				dispatched++;
				return new Response(null, { status: 204 });
			}
			messages.push(JSON.parse(String(init?.body)).messages[0]);
			return Response.json({});
		};
		try {
			const base = {
				chatType: "group" as const,
				groupId: "group",
				speaker: "first",
				mentioned: true,
				text: "改善: 回答を短くしてください",
				replyToken: "r",
				eventId: "proposal",
				messageId: "proposal-message",
				occurredAt: Date.now(),
			};
			await instance.receive(base);
			expect(messages).toHaveLength(0);
			await instance.answer(jobs.shift() as GenerationJob);
			expect(dispatched).toBe(0);
			expect(messages[0]?.text).toContain("回答を短くしてください");
			const approve = messages[0]?.quickReply?.items[0]?.action.data ?? "";
			const cancel = messages[0]?.quickReply?.items[1]?.action.data ?? "";
			await instance.receive({
				...base,
				mentioned: false,
				speaker: "second",
				text: "",
				eventId: "click",
				postback: approve,
			});
			await instance.receive({
				...base,
				mentioned: false,
				text: "",
				eventId: "again",
				postback: approve,
			});
			expect(dispatched).toBe(1);
			expect(new QuickReplies(state.storage.sql).consume(cancel, "first", Date.now())).toBeNull();
			await instance.receive({ ...base, eventId: "other-proposal", messageId: "other-message" });
			await instance.answer(jobs.shift() as GenerationJob);
			const last = messages.at(-1);
			const cancelledApprove = last?.quickReply?.items[0]?.action.data ?? "";
			await instance.receive({
				...base,
				mentioned: false,
				text: "",
				eventId: "cancel",
				postback: last?.quickReply?.items[1]?.action.data ?? "",
			});
			expect(messages.at(-1)?.text).toContain("キャンセルしました");
			await instance.receive({
				...base,
				mentioned: false,
				text: "",
				eventId: "cancelled-approve",
				postback: cancelledApprove,
			});
			expect(dispatched).toBe(1);
		} finally {
			globalThis.fetch = original;
		}
	});
});
