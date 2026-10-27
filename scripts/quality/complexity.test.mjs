import assert from "node:assert/strict";
import test from "node:test";
import { complexityEntries, violations } from "./complexity.mjs";

test("blocks new complex functions and increases, but allows existing scores and reductions", () => {
	assert.deepEqual(
		violations(
			[
				{ key: "old", score: 21 },
				{ key: "new", score: 16 },
				{ key: "small", score: 15 },
			],
			{ old: 20 },
		),
		[
			{ key: "old", score: 21 },
			{ key: "new", score: 16 },
		],
	);
	assert.deepEqual(violations([{ key: "old", score: 19 }], { old: 20 }), []);
});
test("finds functions with Japanese text before UTF-8 spans and stable callback labels", () => {
	const sourceCode =
		"// 日本語\nasync function answer(){ data.map(x=>x); await locked(async () => { if (true) return; }); }";
	const start = Buffer.byteLength(sourceCode.slice(0, sourceCode.indexOf("async ()")));
	const diagnostics = [
		{
			category: "lint/complexity/noExcessiveCognitiveComplexity",
			description: "Excessive complexity of 20 detected (max: 15).",
			location: { sourceCode, span: [start, start + 5], path: { file: "src/test.ts" } },
		},
	];
	assert.deepEqual(complexityEntries(diagnostics), [
		{ key: "src/test.ts:/answer/locked", score: 20 },
	]);
	assert.throws(() => complexityEntries([{ ...diagnostics[0], description: "changed format" }]));
});
