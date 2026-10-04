import assert from "node:assert/strict";
import { test } from "node:test";
import { describePullRequest } from "./pr-description.mjs";
const id = "08459068-5313-4098-b516-5a26871d1f12";
test("writes Japanese intent, behavior changes and verified results separately from ID", () => {
	const result = describePullRequest(
		[
			{
				path: "src/application/prompts/secretary.ts",
				content: "",
				prTitle: "予定の回答に日本時間を明記する",
				changeSummary: "時差の誤解を避けるため、通知時刻に日本時間を付記する。",
			},
		],
		"予定の時刻を分かりやすく",
		id,
		"2",
	);
	assert.equal(result.title, "予定の回答に日本時間を明記する");
	assert.ok(!result.title.includes(id));
	assert.match(result.body, /時差の誤解/);
	assert.match(result.body, /pnpm verify/);
	assert.match(result.body, /追跡用/);
});
test("fallback preserves request and treats shell characters as text", () => {
	const result = describePullRequest(
		[{ path: "tests/unit/example.test.ts", content: "" }],
		"日本語の説明 $(touch /tmp/nope)\n追加の条件",
		id,
		"1",
	);
	assert.match(result.title, /改善: 日本語/);
	assert.match(result.body, /> 追加の条件/);
	assert.match(result.title, /\$\(touch/);
});
