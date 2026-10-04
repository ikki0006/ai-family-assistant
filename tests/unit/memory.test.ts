import { expect, it, vi } from "vitest";
import { buildContext, contextSize } from "../../src/application/conversation/build-context";
import type { ConversationSnapshot } from "../../src/application/conversation/conversation";
import { receiveConversation } from "../../src/application/conversation/receive-conversation";
import { compactConversation } from "../../src/application/memory/compact-conversation";
import type { ConversationStore } from "../../src/application/ports/conversation-store";
const now = Date.parse("2026-10-04T02:00:00Z");
function snapshot(): ConversationSnapshot {
	return {
		epoch: 0,
		revision: 0,
		summaries: [],
		messages: Array.from({ length: 8 }, (_, i) => ({
			id: String(i),
			role: "user",
			speaker: "fictional",
			day: "2026-10-04",
			occurredAt: now + i,
			text: `予定${i} ${"話題".repeat(160)}`,
		})),
	};
}
function store(): ConversationStore {
	return {
		append: vi.fn().mockResolvedValue({ messageId: "m", epoch: 0 }),
		snapshot: vi.fn(),
		saveSummary: vi.fn().mockResolvedValue(true),
		forget: vi.fn(),
		reset: vi.fn(),
		prune: vi.fn(),
	};
}
it("saves ordinary messages without invoking the response flow; excludes other groups", async () => {
	const memory = store();
	const respond = vi.fn();
	const reply = vi.fn();
	const receive = receiveConversation(memory, "family", respond, { reply }, () => now);
	const input = {
		eventId: "event",
		messageId: "m",
		occurredAt: now,
		chatType: "group" as const,
		groupId: "family",
		mentioned: false,
		text: "明日はカレー",
		replyToken: "token",
	};
	await receive(input);
	expect(memory.append).toHaveBeenCalledOnce();
	expect(respond).not.toHaveBeenCalled();
	await receive({ ...input, groupId: "other", mentioned: true });
	expect(memory.append).toHaveBeenCalledOnce();
	await receive({ ...input, mentioned: true });
	expect(respond).toHaveBeenCalledWith(
		expect.objectContaining({ memory: { messageId: "m", epoch: 0 } }),
	);
});
it("reset and unsend do not become conversation messages", async () => {
	const memory = store();
	const respond = vi.fn();
	const reply = vi.fn();
	const receive = receiveConversation(memory, "family", respond, { reply }, () => now);
	const input = {
		eventId: "event",
		messageId: "m",
		occurredAt: now,
		chatType: "group" as const,
		groupId: "family",
		mentioned: true,
		text: "履歴リセット",
		replyToken: "token",
	};
	await receive(input);
	expect(memory.reset).toHaveBeenCalledOnce();
	expect(reply).toHaveBeenCalledOnce();
	await receive({ ...input, unsend: true });
	expect(memory.forget).toHaveBeenCalledOnce();
	expect(memory.append).not.toHaveBeenCalled();
});
it("bounds Japanese input and keeps the latest question with a separate trusted system prompt", () => {
	const source = snapshot();
	const question = source.messages[7];
	if (question) question.text = "明日の予定は？";
	const input = buildContext(source, now);
	expect(input.messages.at(-1)?.content).toContain("明日の予定は？");
	expect(contextSize(JSON.stringify(input))).toBeLessThan(8000);
	expect(input.system).toContain("家族");
	expect(input.system).not.toContain("予定0");
});
it("summarizes only older messages and preserves the recent tail", async () => {
	const memory = store();
	const generate = vi.fn().mockResolvedValue("予定を相談している。");
	const original = snapshot();
	const result = await compactConversation(original, memory, { generate });
	expect(generate).toHaveBeenCalledOnce();
	expect(memory.saveSummary).toHaveBeenCalledOnce();
	expect(result.messages.slice(-3)).toEqual(original.messages.slice(-3));
	expect(result.summaries).toHaveLength(1);
});
it("does not overwrite a summary when deletion changes its revision, or when inference fails", async () => {
	const memory = store();
	vi.mocked(memory.saveSummary).mockResolvedValue(false);
	const original = snapshot();
	expect(
		await compactConversation(original, memory, { generate: vi.fn().mockResolvedValue("old") }),
	).toBe(original);
	expect(
		await compactConversation(original, memory, {
			generate: vi.fn().mockRejectedValue(new Error("budget")),
		}),
	).toBe(original);
});
it("does not call the model for small histories", async () => {
	const original = snapshot();
	original.messages = original.messages.slice(-1);
	const generate = vi.fn();
	expect(await compactConversation(original, store(), { generate })).toBe(original);
	expect(generate).not.toHaveBeenCalled();
});
