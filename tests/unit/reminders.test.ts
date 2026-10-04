import { describe, expect, it } from "vitest";
import {
	explicitReminderRequest,
	reminderCandidate,
} from "../../src/application/conversation/participation";
import { parseReminderAction } from "../../src/application/reminders/manage-reminders";
import { nextOccurrence, parseJst } from "../../src/domain/reminders/recurrence";
import { parseWebhook } from "../../src/presentation/router/line-webhook";
const now = Date.parse("2026-10-04T09:00:00Z");
describe("reminder rules", () => {
	it("keeps JST clock and skips missed recurring occurrences", () => {
		expect(nextOccurrence({ kind: "daily", at: now }, now + 2 * 86400000 + 1)).toBe(
			now + 3 * 86400000,
		);
		expect(nextOccurrence({ kind: "weekly", at: now }, now)).toBe(now + 7 * 86400000);
		expect(nextOccurrence({ kind: "once", at: now }, now)).toBeNull();
	});
	it("rejects malformed and normalized impossible dates", () => {
		expect(parseJst("2026-10-04T18:00:00+09:00")).toBe(now);
		for (const value of [
			"2026-02-30T18:00:00+09:00",
			"2026-10-04T25:00:00+09:00",
			"2026-10-04T18:00:00Z",
		])
			expect(() => parseJst(value)).toThrow();
	});
	it("rejects unsupported actions and types from the model", () => {
		for (const value of [
			"null",
			'{"action":"sql"}',
			'{"action":"create","kind":"hourly"}',
			'{"action":"pause","version":"1"}',
		])
			expect(() => parseReminderAction(value)).toThrow();
	});
	it("finds deadlines but distinguishes an explicit request", () => {
		expect(reminderCandidate("明日までに提出しなきゃ")).toBe(true);
		expect(explicitReminderRequest("明日までに提出しなきゃ")).toBe(false);
		expect(explicitReminderRequest("18時に夕飯をリマインドして")).toBe(true);
		expect(reminderCandidate("おいしかった")).toBe(false);
	});
	it("ignores all stickers including quoted and mentioned stickers", () => {
		const events = Array.from({ length: 50 }, (_, i) => ({
			type: "message",
			replyToken: "r",
			source: { type: "group", groupId: "g" },
			message: {
				type: "sticker",
				id: String(i),
				quotedMessageId: "bot",
				mention: { mentionees: [] },
			},
		}));
		expect(parseWebhook(JSON.stringify({ events }))).toEqual([]);
	});
	it("preserves text quote IDs without treating human quotes as mentions", () => {
		const events = [
			{
				type: "message",
				replyToken: "r",
				source: { type: "group", groupId: "g" },
				message: { type: "text", id: "1", text: "お願い", quotedMessageId: "bot" },
			},
		];
		expect(parseWebhook(JSON.stringify({ events }))?.[0]).toMatchObject({
			quotedMessageId: "bot",
			mentioned: false,
		});
	});
});
