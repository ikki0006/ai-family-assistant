import assert from "node:assert/strict";
import test from "node:test";
import { generateFiles } from "./gemini.mjs";
const input = {
	accountId: "a".repeat(32),
	gatewayId: "ai-family-assistant",
	token: "private-token",
	specification: "Make replies concise",
	sources: ["src/application/prompts/example.ts\nexport const text='example';"],
};
const files = [
	{ path: "src/application/prompts/example.ts", content: "export const text='short';" },
];
function response(text, finishReason = "STOP") {
	return Response.json({
		candidates: [
			{ finishReason, content: { parts: [{ thought: true, text: "not-output" }, { text }] } },
		],
	});
}
test("uses stored Google key through budget Gateway, with bounded generation and no logs", async () => {
	let calls = 0;
	const result = await generateFiles(input, async (url, options) => {
		calls++;
		assert.match(
			url,
			/gateway\.ai\.cloudflare\.com\/v1\/a{32}\/ai-family-assistant\/google-ai-studio\/v1beta\/models\/gemini-3\.8-flash:generateContent$/,
		);
		assert.equal(options.headers["cf-aig-authorization"], "Bearer private-token");
		assert.equal(options.headers["cf-aig-byok-alias"], "default");
		assert.equal(options.headers["cf-aig-collect-log"], "false");
		const body = JSON.parse(options.body);
		assert.equal(body.generationConfig.maxOutputTokens, 8000);
		assert.equal(body.generationConfig.responseMimeType, "application/json");
		return response(JSON.stringify(files));
	});
	assert.deepEqual(result, files);
	assert.equal(calls, 1);
});
test("rejects incomplete, malformed and forbidden modifications without leaking output", async () => {
	for (const result of [
		response("private-text"),
		response(JSON.stringify(files), "MAX_TOKENS"),
		response("[]"),
		response(JSON.stringify([{ path: ".github/workflows/x.yml", content: "bad" }])),
	]) {
		await assert.rejects(
			() => generateFiles(input, async () => result),
			/Improvement result is incomplete/,
		);
	}
});
test("does not retry or fall back when budget, authorization or transport fails", async () => {
	for (const status of [401, 402, 429, 500]) {
		let calls = 0;
		await assert.rejects(
			() =>
				generateFiles(input, async () => {
					calls++;
					return new Response("private-body", { status });
				}),
			new RegExp(`\\(${status}\\)`),
		);
		assert.equal(calls, 1);
	}
	await assert.rejects(
		() =>
			generateFiles(input, async () => {
				throw new Error("private-token");
			}),
		/transport failed or timed out/,
	);
});
test("rejects invalid destinations and unbounded input before network access", async () => {
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return response(JSON.stringify(files));
	};
	for (const invalid of [
		{ gatewayId: "../other" },
		{ accountId: "invalid" },
		{ token: "" },
		{ sources: ["x".repeat(80001)] },
	])
		await assert.rejects(() => generateFiles({ ...input, ...invalid }, fetcher));
	assert.equal(calls, 0);
});
