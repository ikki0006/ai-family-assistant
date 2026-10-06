import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { loadSources, selectSources } from "./context.mjs";
import { allowedPath } from "./files.mjs";
import { generateFiles } from "./gemini.mjs";

async function main() {
	if (!/^[a-f0-9-]{36}$/.test(process.env.IMPROVEMENT_ID ?? ""))
		throw new Error("Invalid request ID");

	const paths = execFileSync("git", ["ls-files", "src", "tests"], { encoding: "utf8" })
		.trim()
		.split("\n")
		.filter(allowedPath);
	const config = {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
		gatewayId: process.env.AI_GATEWAY_ID,
		token: process.env.CF_IMPROVEMENT_GATEWAY_TOKEN,
		specification: process.env.IMPROVEMENT_SPECIFICATION,
	};
	const selected = await selectSources(config, paths);
	const sources = await loadSources(selected, (path) => readFile(path, "utf8"));
	process.stdout.write(
		`Selected ${sources.length} sources (${sources.join("\n").length} characters)\n`,
	);
	const files = await generateFiles({ ...config, sources });
	await writeFile("improvement-files.json", JSON.stringify(files));
}
await main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : "Improvement generation failed"}\n`,
	);
	process.exitCode = 1;
});
