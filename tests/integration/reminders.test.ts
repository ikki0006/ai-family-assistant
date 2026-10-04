import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import migration from "../../migrations/0002_garbage_reminders.sql?raw";
import profileMigration from "../../migrations/0007_family_profiles.sql?raw";
import { runGarbageReminder } from "../../src/bootstrap/run-garbage-reminder";

const db = (env as unknown as { DB: D1Database }).DB;
const time = Date.parse("2026-10-05T14:00:00Z");
const bindings = {
	DB: db,
	LINE_ALLOWED_GROUP_ID: `C${"1".repeat(32)}`,
	LINE_CHANNEL_ACCESS_TOKEN: "test-only-token",
};
// Fictional data only.
const config = {
	validFrom: "2026-01-01",
	validThrough: "2026-12-31",
	rules: [{ label: "架空品目", weekday: 2 }],
	overrides: {},
};

beforeAll(async () => {
	await (env as unknown as { DB: D1Database }).DB.exec(profileMigration.replace(/\n/g, " "));
	await db.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.exec("DELETE FROM reminder_deliveries; DELETE FROM garbage_schedule;");
	await db
		.prepare("INSERT INTO garbage_schedule (id, config_json) VALUES (1, ?)")
		.bind(JSON.stringify(config))
		.run();
});

it("reads D1, sends one Push, and suppresses subsequent cron retries", async () => {
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
	await runGarbageReminder(time, bindings, fetcher, time);
	await runGarbageReminder(time + 5 * 60_000, bindings, fetcher, time + 5 * 60_000);
	expect(fetcher).toHaveBeenCalledOnce();
	expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.line.me/v2/bot/message/push");
	const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
	expect(payload.to).toBe(bindings.LINE_ALLOWED_GROUP_ID);
	expect(payload.messages[0].text).toContain("架空品目");
	const rows = await db.prepare("SELECT * FROM reminder_deliveries").all();
	expect(rows.results).toHaveLength(1);
	expect(JSON.stringify(rows.results)).not.toContain(bindings.LINE_ALLOWED_GROUP_ID);
});

it("retries an ambiguous send with the same LINE retry key", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockRejectedValueOnce(new Error("network lost"))
		.mockResolvedValueOnce(
			new Response("{}", { status: 409, headers: { "x-line-accepted-request-id": "accepted" } }),
		);
	await expect(runGarbageReminder(time, bindings, fetcher, time)).rejects.toThrow(
		"Garbage reminder failed",
	);
	await runGarbageReminder(time + 5 * 60_000, bindings, fetcher, time + 5 * 60_000);
	expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-line-retry-key")).toBe(
		new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("x-line-retry-key"),
	);
	expect((await db.prepare("SELECT * FROM reminder_deliveries").all()).results).toHaveLength(1);
});

it("fails closed for missing destination or corrupt schedule, without external calls", async () => {
	const fetcher = vi.fn<typeof fetch>();
	await expect(
		runGarbageReminder(time, { ...bindings, LINE_ALLOWED_GROUP_ID: "" }, fetcher, time),
	).rejects.toThrow();
	await db.prepare("UPDATE garbage_schedule SET config_json = '{}' WHERE id = 1").run();
	await expect(runGarbageReminder(time, bindings, fetcher, time)).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
