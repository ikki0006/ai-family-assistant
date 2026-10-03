import { expect, it, vi } from "vitest";
import { createRespondToMention } from "../../src/application/conversation/respond-to-mention";

const incoming = {
	chatType: "group" as const,
	groupId: "family",
	mentioned: true,
	text: "  今日のおすすめ料理は？  ",
	replyToken: "reply",
};

it.each([
	{ ...incoming, chatType: "user" as const },
	{ ...incoming, chatType: "room" as const },
	{ ...incoming, groupId: "stranger" },
	{ ...incoming, mentioned: false },
	{ ...incoming, text: "  " },
])("does not send excluded messages to the model", async (message) => {
	const reply = vi.fn();
	const generate = vi.fn();
	await createRespondToMention({ reply }, "family", { generate })(message);
	expect(generate).not.toHaveBeenCalled();
	expect(reply).not.toHaveBeenCalled();
});

it("sends only the current trimmed text to the model", async () => {
	const reply = vi.fn();
	const generate = vi.fn().mockResolvedValue("  カレーはいかがですか？  ");
	await createRespondToMention({ reply }, "family", { generate })(incoming);
	expect(generate).toHaveBeenCalledExactlyOnceWith("今日のおすすめ料理は？");
	expect(reply).toHaveBeenCalledExactlyOnceWith("reply", "カレーはいかがですか？");
});

it.each(["ping", "x".repeat(2001)])(
	"handles ping and overlong input without paying for generation",
	async (text) => {
		const reply = vi.fn();
		const generate = vi.fn();
		await createRespondToMention({ reply }, "family", { generate })({ ...incoming, text });
		expect(generate).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledOnce();
	},
);

it("explains missing AI configuration without affecting ping", async () => {
	const reply = vi.fn();
	await createRespondToMention({ reply }, "family")(incoming);
	expect(reply).toHaveBeenCalledWith("reply", "AIの接続設定がまだ完了していません。");
});

it("sends a safe fallback on generation failure without echoing the exception", async () => {
	const reply = vi.fn();
	const generate = vi.fn().mockRejectedValue(new Error("private key"));
	await createRespondToMention({ reply }, "family", { generate })(incoming);
	expect(reply).toHaveBeenCalledOnce();
	expect(reply.mock.calls[0]?.[1]).not.toContain("private");
});

it("limits long answers without splitting emoji surrogate pairs", async () => {
	const reply = vi.fn();
	const generate = vi.fn().mockResolvedValue("🐟".repeat(3000));
	await createRespondToMention({ reply }, "family", { generate })(incoming);
	const answer = String(reply.mock.calls[0]?.[1]);
	expect(answer.length).toBeLessThan(5000);
	expect(answer.startsWith("🐟".repeat(2000))).toBe(true);
	expect(answer).toContain("ここまで表示");
});

it("does not call the model again or send a second reply after a LINE error", async () => {
	const reply = vi.fn().mockRejectedValue(new Error("LINE failure"));
	const generate = vi.fn().mockResolvedValue("回答");
	await expect(createRespondToMention({ reply }, "family", { generate })(incoming)).rejects.toThrow(
		"LINE failure",
	);
	expect(generate).toHaveBeenCalledOnce();
	expect(reply).toHaveBeenCalledOnce();
});
