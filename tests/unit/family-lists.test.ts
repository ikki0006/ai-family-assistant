import { expect, it } from "vitest";
import {
	listNameKey,
	parseListAction,
	renderLists,
} from "../../src/application/lists/manage-lists";
import { parseReminderAction } from "../../src/application/reminders/manage-reminders";
it("normalizes clear variants and validates list operations separately from reminders", () => {
	expect(listNameKey("言ってみたいお店")).toBe(listNameKey("行きたいお店"));
	expect(
		parseReminderAction('{"action":"collection","collection":{"op":"show"}}').collection?.op,
	).toBe("show");
	for (const v of [
		{ op: "execute" },
		{ op: "add", text: "x".repeat(101) },
		{ op: "show", page: 0 },
	])
		expect(() => parseListAction(v)).toThrow();
});
it("paginates long lists without silently truncating entries", () => {
	const state = {
		version: 1,
		lists: [
			{
				id: "l",
				name: "お店",
				aliases: [],
				items: Array.from({ length: 5 }, (_, i) => ({
					id: String(i),
					text: `架空店${i}`,
					note: "",
				})),
			},
		],
	};
	expect(renderLists(state, "l", 1)).toContain("続きを");
	expect(renderLists(state, "l", 2)).toContain("架空店4");
	expect(renderLists(state)).toContain("お店（5件）");
});
