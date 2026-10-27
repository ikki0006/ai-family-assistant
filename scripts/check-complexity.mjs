import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { complexityEntries, violations } from "./quality/complexity.mjs";

const result = spawnSync(
	"pnpm",
	[
		"exec",
		"biome",
		"lint",
		"src",
		"scripts",
		"--only=complexity/noExcessiveCognitiveComplexity",
		"--config-path=scripts/quality",
		"--reporter=json",
		"--max-diagnostics=1000",
	],
	{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (result.error || ![0, 1].includes(result.status))
	throw new Error("Complexity check could not run");
const report = JSON.parse(result.stdout);
if (!Array.isArray(report.diagnostics)) throw new Error("Invalid complexity report");
const unexpected = report.diagnostics.filter(
	(d) => d.category !== "lint/complexity/noExcessiveCognitiveComplexity",
);
if (unexpected.length)
	throw new Error("Unexpected Biome diagnostics; fix configuration or syntax first");
const baseline = JSON.parse(readFileSync("scripts/quality/complexity-baseline.json", "utf8"));
const entries = complexityEntries(report.diagnostics);
const failures = violations(entries, baseline);
for (const { key, score } of failures)
	process.stderr.write(`${key}: complexity ${score}, allowed ${baseline[key] ?? 15}\n`);
process.stdout.write(
	`Complexity: ${entries.length} existing exceptions, ${failures.length} regressions. New functions must be <=15.\n`,
);
process.exitCode = failures.length ? 1 : 0;
