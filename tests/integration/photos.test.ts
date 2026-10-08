import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { GenerationJob } from "../../src/application/ports/generation-queue";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import { PhotoReferences } from "../../src/infrastructure/memory/photo-references";
const ns = (env as unknown as { CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent> })
	.CONVERSATIONS;
const group = `C${"1".repeat(32)}`;
it("automatically queues family photos and returns OCR without saving content to memory", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const jobs: GenerationJob[] = [];
		const run = vi.fn(async () =>
			Response.json({
				candidates: [
					{ finishReason: "STOP", content: { parts: [{ text: "文字起こし：架空のお知らせ" }] } },
				],
			}),
		);
		Object.defineProperty(instance, "env", {
			value: {
				LINE_ALLOWED_GROUP_ID: group,
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				AI: { gateway: () => ({ run }) },
				AI_GATEWAY_ID: "test",
				JOBS_QUEUE: {
					send: async (job: GenerationJob) => {
						jobs.push(job);
					},
				},
			},
			configurable: true,
		});
		const incoming = {
			chatType: "group" as const,
			groupId: group,
			image: true,
			messageId: "123",
			eventId: "photo",
			occurredAt: Date.now(),
			text: "",
			mentioned: false,
			replyToken: "r",
		};
		await instance.receive({ ...incoming, groupId: "other" });
		expect(jobs).toHaveLength(0);
		await instance.receive(incoming);
		expect(jobs).toHaveLength(1);
		expect(run).not.toHaveBeenCalled();
		const original = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = async (url, init) => {
			calls.push(String(url));
			if (String(url).includes("api-data.line.me"))
				return new Response(new Uint8Array([255, 216, 255, 0]), {
					headers: { "Content-Type": "image/jpeg" },
				});
			expect(String(init?.body)).toContain("架空のお知らせ");
			return Response.json({ sentMessages: [{ id: "reply-id" }] });
		};
		try {
			const job = jobs[0];
			if (!job) throw new Error();
			await instance.answer(job);
			await instance.answer(job);
			expect(run).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(run.mock.calls)).toContain("inlineData");
			expect(calls).toHaveLength(2);
			expect(state.storage.sql.exec("SELECT * FROM family_messages").toArray()).toHaveLength(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});
it("suppresses analysis after unsend and rejects late redelivery of a deleted image", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (instance, state) => {
		const run = vi.fn();
		const send = vi.fn();
		const now = Date.now();
		Object.defineProperty(instance, "env", {
			value: {
				LINE_ALLOWED_GROUP_ID: group,
				LINE_CHANNEL_ACCESS_TOKEN: "test",
				AI: { gateway: () => ({ run }) },
				AI_GATEWAY_ID: "test",
				JOBS_QUEUE: { send },
			},
			configurable: true,
		});
		const photo = {
			chatType: "group" as const,
			groupId: group,
			image: true,
			messageId: "456",
			eventId: "photo-2",
			occurredAt: now,
			text: "",
			mentioned: false,
			replyToken: "r",
		};
		await instance.receive(photo);
		await instance.receive({ ...photo, image: false, unsend: true, eventId: "unsend" });
		await instance.answer({
			eventId: "photo-2",
			groupId: group,
			imageId: "456",
			text: "",
			replyToken: "r",
			receivedAt: now,
		});
		await instance.receive(photo);
		expect(send).toHaveBeenCalledTimes(1);
		expect(run).not.toHaveBeenCalled();
		expect(new PhotoReferences(state.storage.sql).has("456", now)).toBe(false);
	});
});
it("expires image references and pending requests", async () => {
	await runInDurableObject(ns.get(ns.idFromName(crypto.randomUUID())), async (_instance, state) => {
		const photos = new PhotoReferences(state.storage.sql);
		photos.record("789", 100, 100);
		photos.request("event", "789", 100);
		expect(photos.valid("event", "789", 100)).toBe(true);
		expect(photos.valid("event", "789", 86400200)).toBe(false);
	});
});
