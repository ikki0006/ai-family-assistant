import assert from "node:assert/strict";
import test from "node:test";
import { validateFiles } from "./files.mjs";

test("permits only bounded prompt and unit test files", () => {
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
		"src/application/prompts/nested/x.ts",
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
