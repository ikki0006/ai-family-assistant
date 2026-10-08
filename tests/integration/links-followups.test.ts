import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import reminders from "../../migrations/0003_reminders.sql?raw";
import calendar from "../../migrations/0006_calendar_reminders.sql?raw";
import profiles from "../../migrations/0007_family_profiles.sql?raw";
import lists from "../../migrations/0008_family_lists.sql?raw";
import type { GenerationJob } from "../../src/application/ports/generation-queue";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import { PendingQuestions } from "../../src/infrastructure/memory/pending-questions";
import { createFamilyLists } from "../../src/infrastructure/persistence/d1/family-lists";
const ns = (env as unknown as { CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent> })
	.CONVERSATIONS;
const group = `C${"1".repeat(32)}`;
function message(text: string, speaker = "one", extra = {}) {
	const id = crypto.randomUUID();
	return {
		chatType: "group" as const,
		groupId: group,
		speaker,
		mentioned: false,
		text,
		replyToken: "reply",
		eventId: id,
		messageId: id,
		occurredAt: Date.now(),
		...extra,
	};
}
function result(text: string) {
	return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] });
}
it("limits pending questions by speaker, timestamp, expiry and scan count", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (_instance, state) => {
		const questions = new PendingQuestions(state.storage.sql);
		questions.set("one", "何時に？", 100);
		expect(questions.candidate("two", 101, 101)).toBeUndefined();
		expect(questions.candidate("one", 99, 101)).toBeUndefined();
		const first = questions.candidate("one", 101, 101);
		if (!first) throw new Error();
		for (let i = 0; i < 4; i++) expect(questions.candidate("one", 101, 101)).toBeDefined();
		expect(questions.candidate("one", 101, 101)).toBeUndefined();
		expect(questions.get("one", first.id, 600101)).toBeUndefined();
		questions.set("one", "別の質問？", 200);
		expect(questions.get("one", first.id, 201)).toBeUndefined();
		questions.clear();
		expect(questions.candidate("one", 201, 201)).toBeUndefined();
	});
});
it("reads a bare URL, asks confirmation, and handles a plain answer without mention", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const jobs: GenerationJob[] = [];
		const run = vi
			.fn()
			.mockImplementationOnce(async () =>
				result('{"text":"架空公園で合っていますか？","choices":["はい","違います"]}'),
			)
			.mockImplementationOnce(async () => result('{"reply":false}'))
			.mockImplementationOnce(async () => result('{"reply":true}'))
			.mockImplementationOnce(async () => result('{"query":null}'))
			.mockImplementationOnce(async () => result("行きたい公園リストに追加しますか？"));
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				LINE_ALLOWED_GROUP_ID: group,
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				TAVILY_API_KEY: "test",
				AI: { gateway: () => ({ run }) },
				AI_GATEWAY_ID: "test",
				JOBS_QUEUE: {
					send: async (j: GenerationJob) => {
						jobs.push(j);
					},
				},
			},
		});
		const replies: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			if (String(url) === "https://api.tavily.com/extract")
				return Response.json({
					results: [{ url: "https://example.com/park", raw_content: "架空公園・架空市" }],
				});
			expect(String(url)).toContain("api.line.me");
			replies.push(String(init?.body));
			return Response.json({ sentMessages: [{ id: crypto.randomUUID() }] });
		};
		try {
			await instance.receive(message("https://example.com/park"));
			expect(jobs).toHaveLength(1);
			expect(run).not.toHaveBeenCalled();
			await instance.answer(jobs[0] as GenerationJob);
			expect(replies[0]).toContain("架空公園");
			expect(replies[0]).toContain("quickReply");
			await instance.receive(message("はい", "two"));
			await instance.receive(message("はい", "one", { quotedMessageId: "human-message" }));
			expect(jobs).toHaveLength(1);
			await instance.receive(message("別の話です"));
			expect(jobs[1]?.followupId).toBeDefined();
			await instance.answer(jobs[1] as GenerationJob);
			expect(replies).toHaveLength(1);
			await instance.receive(message("はい"));
			await instance.answer(jobs[2] as GenerationJob);
			expect(replies).toHaveLength(2);
			expect(replies[1]).toContain("追加しますか");
			expect(JSON.stringify(run.mock.calls)).toContain("quotedBotMessage");
			expect(state.storage.sql.exec("SELECT * FROM pending_questions").toArray()).toHaveLength(1);
		} finally {
			globalThis.fetch = original;
		}
	});
});
it("does not answer a queued reply after the pending question was replaced or cleared", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const jobs: GenerationJob[] = [];
		const run = vi.fn();
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
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
		const questions = new PendingQuestions(state.storage.sql);
		questions.set("one", "何時？", Date.now() - 1);
		await instance.receive(message("18時"));
		expect(jobs).toHaveLength(1);
		questions.clear();
		await instance.answer(jobs[0] as GenerationJob);
		expect(run).not.toHaveBeenCalled();
	});
});

it("adds the resolved place to D1 only after a plain confirmation reply", async () => {
	const db = (env as unknown as { DB: D1Database }).DB;
	for (const migration of [reminders, calendar, profiles, lists])
		await db.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance) => {
		const jobs: GenerationJob[] = [];
		const run = vi
			.fn()
			.mockImplementationOnce(async () =>
				result(
					'{"text":"行きたい公園リストに架空公園を追加する、で合っていますか？","choices":["はい","違います"]}',
				),
			)
			.mockImplementationOnce(async () => result('{"reply":true}'))
			.mockImplementationOnce(async () =>
				result(
					'{"action":"collection","collection":{"op":"create","name":"行きたい公園","text":"架空公園"}}',
				),
			);
		Object.defineProperty(instance, "env", {
			configurable: true,
			value: {
				DB: db,
				LINE_ALLOWED_GROUP_ID: group,
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				TAVILY_API_KEY: "test",
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
		globalThis.fetch = async (url) => {
			if (String(url) === "https://api.tavily.com/extract")
				return Response.json({
					results: [{ url: "https://example.com/park", raw_content: "架空公園・架空市" }],
				});
			expect(String(url)).toContain("api.line.me");
			return Response.json({ sentMessages: [{ id: crypto.randomUUID() }] });
		};
		try {
			await instance.receive(
				message("行きたい公園に追加して https://example.com/park", "one", { mentioned: true }),
			);
			await instance.answer(jobs[0] as GenerationJob);
			expect((await createFamilyLists(db).load(group)).lists).toHaveLength(0);
			await instance.receive(message("はい"));
			await instance.answer(jobs[1] as GenerationJob);
			const saved = (await createFamilyLists(db).load(group)).lists;
			expect(saved).toHaveLength(1);
			expect(saved[0]?.items[0]?.text).toBe("架空公園");
			expect(JSON.stringify(run.mock.calls)).toContain("followupQuestion");
		} finally {
			globalThis.fetch = original;
		}
	});
});
