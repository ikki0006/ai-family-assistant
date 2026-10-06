import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import migration from "../../migrations/0001_generation_claims.sql?raw";
import profileMigration from "../../migrations/0007_family_profiles.sql?raw";
import listMigration from "../../migrations/0008_family_lists.sql?raw";
import { processGenerationBatch } from "../../src/bootstrap/process-generation-batch";
import { createGenerationClaims } from "../../src/infrastructure/persistence/d1/generation-claims";

const db = (env as unknown as { DB: D1Database }).DB;
const group = `C${"2".repeat(32)}`;
const run = vi.fn().mockImplementation(async () =>
	Response.json({
		candidates: [{ finishReason: "STOP", content: { parts: [{ text: "こんにちは！" }] } }],
	}),
);
const bindings = {
	DB: db,
	LINE_ALLOWED_GROUP_ID: group,
	LINE_CHANNEL_ACCESS_TOKEN: "test-token",
	AI_GATEWAY_ID: "test-gateway",
	AI: { gateway: () => ({ run }) } as unknown as Ai,
};

beforeAll(async () => {
	await (env as unknown as { DB: D1Database }).DB.exec(profileMigration.replace(/\n/g, " "));
	await (env as unknown as { DB: D1Database }).DB.exec(listMigration.replace(/\n/g, " "));
	await db.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
beforeEach(async () => {
	await db.prepare("DELETE FROM generation_claims").run();
	vi.mocked(run).mockClear();
});

function batch(groupId = group, receivedAt = Date.now()) {
	const message = {
		body: {
			eventId: "test-event",
			groupId,
			receivedAt,
			text: "こんにちは",
			replyToken: "test-reply",
		},
		id: "queue-id",
		timestamp: new Date(),
		attempts: 1,
		ack: vi.fn(),
		retry: vi.fn(),
	};
	return {
		queue: "test-jobs",
		metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
		messages: [message],
		ackAll: vi.fn(),
		retryAll: vi.fn(),
	};
}
function transport() {
	return vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
}

it("generates with Gemini through AI Gateway and D1 deduplication, then replies once", async () => {
	const fetcher = transport();
	const first = batch();
	await processGenerationBatch(first, bindings, fetcher);
	await processGenerationBatch(batch(), bindings, fetcher);
	expect(first.messages[0]?.ack).toHaveBeenCalledOnce();
	expect(run).toHaveBeenCalledOnce();
	expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
		"https://api.line.me/v2/bot/message/reply",
	]);
	const rows = await db.prepare("SELECT * FROM generation_claims").all();
	expect(rows.results).toEqual([{ event_id: "test-event", created_at: expect.any(Number) }]);
});

it("allows only one concurrent generation claim", async () => {
	const claims = createGenerationClaims(db);
	const results = await Promise.all([
		claims.claim("same-event", Date.now()),
		claims.claim("same-event", Date.now()),
	]);
	expect(results.filter(Boolean)).toHaveLength(1);
});

it("rechecks authorization and drops stale jobs before model calls", async () => {
	const fetcher = transport();
	for (const value of [batch(`C${"3".repeat(32)}`), batch(group, Date.now() - 11 * 60_000)]) {
		await processGenerationBatch(value, bindings, fetcher);
		expect(value.messages[0]?.ack).toHaveBeenCalledOnce();
	}
	expect(fetcher).not.toHaveBeenCalled();
});

it("uses Push for delayed jobs", async () => {
	const fetcher = transport();
	await processGenerationBatch(batch(group, Date.now() - 60_000), bindings, fetcher);
	expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.line.me/v2/bot/message/push");
});

it("sends a failed delivery toward the DLQ and never regenerates that event", async () => {
	const fetcher = transport();
	fetcher.mockResolvedValueOnce(new Response("failure", { status: 500 }));
	const first = batch();
	await processGenerationBatch(first, bindings, fetcher);
	expect(first.messages[0]?.retry).toHaveBeenCalledOnce();
	await processGenerationBatch(batch(), bindings, fetcher);
	expect(fetcher).toHaveBeenCalledOnce();
});
