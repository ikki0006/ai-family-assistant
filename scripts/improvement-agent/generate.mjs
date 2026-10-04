import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { allowedPath } from "./files.mjs";
import { generateFiles } from "./gemini.mjs";

async function main() {
	if (!/^[a-f0-9-]{36}$/.test(process.env.IMPROVEMENT_ID ?? ""))
		throw new Error("Invalid request ID");
	const sources = [];
	const paths = execFileSync("git", ["ls-files", "src", "tests"], { encoding: "utf8" })
		.trim()
		.split("\n")
		.filter(allowedPath);
	// Bootstrap and ports expose wiring; include a manifest for files outside the bounded context.
	sources.push(`Allowed source paths:\n${paths.join("\n")}`);
	paths.sort(
		(a, b) =>
			Number(b.includes("bootstrap/")) - Number(a.includes("bootstrap/")) || a.localeCompare(b),
	);
	for (const path of paths) {
		const entry = `${path}\n${await readFile(path, "utf8")}`;
		if ([...sources, entry].join("\n").length <= 80000) sources.push(entry);
	}

	const files = await generateFiles({
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
		gatewayId: process.env.AI_GATEWAY_ID,
		token: process.env.CF_IMPROVEMENT_GATEWAY_TOKEN,
		specification: process.env.IMPROVEMENT_SPECIFICATION,
		sources,
	});
	await writeFile("improvement-files.json", JSON.stringify(files));
}
await main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : "Improvement generation failed"}\n`,
	);
	process.exitCode = 1;
});
