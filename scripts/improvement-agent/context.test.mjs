import assert from "node:assert/strict";
import test from "node:test";
import { loadSources, selectSources } from "./context.mjs";
const config = {
	accountId: "a".repeat(32),
	gatewayId: "test",
	token: "fictional",
	specification: "Improve a fictional feature",
};
const paths = ["src/application/memory/example.ts", "tests/unit/example.test.ts"];
const response = (value) =>
	Response.json({
		candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
	});
test("uses relevant selected paths and never silently truncates files", async () => {
	const selected = await selectSources(config, paths, async () => response([paths[1], paths[0]]));
	assert.deepEqual(selected, [paths[1], paths[0]]);
	assert.deepEqual(
		await loadSources(selected, async () => "complete"),
		selected.map((p) => `${p}\ncomplete`),
	);
	await assert.rejects(() => loadSources(selected, async () => "x".repeat(50000)), /80000/);
});
test("rejects unknown, duplicate and unsafe source choices", async () => {
	for (const value of [[], [".env"], [paths[0], paths[0]], Array(13).fill(paths[0])])
		await assert.rejects(
			() => selectSources(config, paths, async () => response(value)),
			/Source selection/,
		);
});
