import assert from "node:assert/strict";
import test from "node:test";
import { validateFiles } from "./files.mjs";

test("permits only bounded application and test files", () => {
	assert.equal(
		validateFiles([{ path: "src/application/prompts/example.ts", content: "example" }]).length,
		1,
	);
	assert.equal(
		validateFiles([{ path: "tests/unit/example.test.ts", content: "example" }]).length,
		1,
	);
	for (const path of [
		"../x",
		".github/workflows/x.yml",
		"tests/unit/../../x.test.ts",
		"src/index.ts",
		"src/presentation/router/line-webhook.ts",
		"migrations/0007.sql",
		"scripts/improvement-agent/files.mjs",
		"src/bootstrap/../../.env.ts",
	]) {
		assert.throws(() => validateFiles([{ path, content: "example" }]));
	}
});

test("rejects duplicates, oversized content, empty and excessive file lists", () => {
	const file = { path: "src/application/prompts/example.ts", content: "example" };
	assert.throws(() => validateFiles([file, file]));
	assert.throws(() => validateFiles([{ ...file, content: "x".repeat(30001) }]));
	assert.throws(() => validateFiles([]));
	assert.throws(() => validateFiles(Array(6).fill(file)));
	assert.throws(() => validateFiles([{ path: file.path }]));
});

test("permits application wiring and integration tests", () => {
	for (const path of [
		"src/bootstrap/family-conversation-agent.ts",
		"src/infrastructure/persistence/d1/reminders.ts",
		"tests/integration/generation.test.ts",
	])
		assert.equal(validateFiles([{ path, content: "example" }]).length, 1);
});
