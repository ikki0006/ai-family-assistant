import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../docs/adr/", import.meta.url);
const names = readdirSync(directory).filter((name) => /^\d{4}-.*\.md$/.test(name));
const required = ["Status", "Context", "Decision", "Consequences", "Enforcement"];
const numbers = new Set();
const errors = [];
for (const name of names) {
	const number = name.slice(0, 4);
	if (numbers.has(number)) errors.push(`${name}: duplicate ADR number`);
	numbers.add(number);
	const body = readFileSync(new URL(name, directory), "utf8");
	for (const heading of required) {
		if (!body.includes(`\n## ${heading}\n`)) errors.push(`${name}: missing ${heading}`);
	}
	if (!/## Status\n\n(Accepted|Proposed|Deprecated|Superseded)/.test(body)) {
		errors.push(`${name}: invalid status`);
	}
}
if (names.length === 0) errors.push("No ADRs found");
if (errors.length) {
	process.stderr.write(`${errors.join("\n")}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(`ADR check passed (${names.length} files)\n`);
}
