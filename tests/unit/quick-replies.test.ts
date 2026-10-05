import { expect, it } from "vitest";
import { parseReplyChoices } from "../../src/application/conversation/reply-choices";
import { textMessage } from "../../src/infrastructure/line/text-message";
import { parseWebhook } from "../../src/presentation/router/line-webhook";
it("validates expected answers and preserves ordinary text", () => {
	expect(parseReplyChoices('{"text":"確認？","choices":["はい","いいえ"]}')).toEqual({
		text: "確認？",
		choices: ["はい", "いいえ"],
	});
	expect(parseReplyChoices("回答です")).toEqual({ text: "回答です", choices: [] });
	expect(parseReplyChoices('{"text":"確認？","choices":["はい","はい"]}').choices).toEqual([]);
});
it("sends opaque postback choices and accepts postback webhook events", () => {
	const data = `qr:${"a".repeat(36)}`;
	expect(textMessage("確認？", [{ label: "はい", data, displayText: "はい" }])).toMatchObject({
		quickReply: { items: [{ action: { type: "postback", data, displayText: "はい" } }] },
	});
	const event = {
		type: "postback",
		webhookEventId: "click",
		timestamp: 1,
		replyToken: "reply",
		source: { type: "group", groupId: "group", userId: "speaker" },
		postback: { data },
	};
	expect(parseWebhook(JSON.stringify({ events: [event] }))).toMatchObject([
		{ postback: data, speaker: "speaker", mentioned: false },
	]);
	expect(
		parseWebhook(
			JSON.stringify({ events: [{ ...event, postback: { data: "arbitrary-command" } }] }),
		),
	).toEqual([]);
});
