import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { FamilyConversationAgent } from "../../src/bootstrap/family-conversation-agent";
import { QuickReplies } from "../../src/infrastructure/memory/quick-replies";
import { SessionConversationStore } from "../../src/infrastructure/memory/session-conversation-store";
const namespace = (
	env as unknown as { CONVERSATIONS: DurableObjectNamespace<FamilyConversationAgent> }
).CONVERSATIONS;
it("binds answers to the question and speaker, consumes siblings and expires tokens", async () => {
	await runInDurableObject(
		namespace.get(namespace.idFromName(crypto.randomUUID())),
		async (_instance, state) => {
			const replies = new QuickReplies(state.storage.sql);
			const choice = {
				kind: "conversation" as const,
				text: "はい",
				question: "明日18時に通知しますか？",
			};
			const issue = () =>
				replies.issue(
					[
						{ label: "はい", choice },
						{ label: "いいえ", choice: { ...choice, text: "いいえ" } },
					],
					"speaker",
					100,
					100,
				);
			const buttons = issue();
			expect(replies.consume(buttons[0]?.data ?? "", "other", 101)).toBeNull();
			expect(replies.consume(buttons[0]?.data ?? "", "speaker", 101)).toEqual(choice);
			expect(replies.consume(buttons[1]?.data ?? "", "speaker", 101)).toBeNull();
			expect(replies.consume(issue()[0]?.data ?? "", "speaker", 200)).toBeNull();
			const data = issue()[0]?.data ?? "";
			replies.clear();
			expect(replies.consume(data, "speaker", 101)).toBeNull();
		},
	);
});
it("queues a selected answer without a mention and keeps original question context", async () => {
	await runInDurableObject(
		namespace.get(namespace.idFromName(crypto.randomUUID())),
		async (instance, state) => {
			const send = vi.fn();
			Object.defineProperty(instance, "env", {
				value: {
					LINE_ALLOWED_GROUP_ID: "group",
					LINE_CHANNEL_ACCESS_TOKEN: "test",
					AI: { gateway: () => ({ run: vi.fn() }) },
					AI_GATEWAY_ID: "test",
					JOBS_QUEUE: { send },
				},
				configurable: true,
			});
			const replies = new QuickReplies(state.storage.sql);
			const button = replies.issue(
				[
					{
						label: "はい",
						choice: { kind: "conversation", text: "はい", question: "夕飯を18時に通知しますか？" },
					},
				],
				"speaker",
				Date.now(),
			)[0];
			if (!button) throw new Error("missing button");
			await instance.receive({
				chatType: "group",
				groupId: "group",
				speaker: "speaker",
				mentioned: false,
				text: "",
				replyToken: "reply",
				eventId: "click",
				messageId: "postback:click",
				occurredAt: Date.now(),
				postback: button.data,
			});
			expect(send).toHaveBeenCalledTimes(1);
			expect(
				JSON.stringify(
					await new SessionConversationStore(state.storage.sql, instance.sessions).snapshot(
						send.mock.calls[0]?.[0].memory,
						Date.now(),
					),
				),
			).toContain("夕飯を18時に通知しますか？");
		},
	);
});
