import { readFile, readdir, writeFile } from "node:fs/promises";
import { generateFiles } from "./gemini.mjs";

async function main() {
	if (!/^[a-f0-9-]{36}$/.test(process.env.IMPROVEMENT_ID ?? ""))
		throw new Error("Invalid request ID");
	const sources = [];
	for (const directory of ["src/application/prompts", "tests/unit"]) {
		for (const name of (await readdir(directory)).sort()) {
			const path = `${directory}/${name}`;
			if (!name.endsWith(".ts")) continue;
			const content = await readFile(path, "utf8");
			const entry = `${path}\n${content}`;
			if ([...sources, entry].join("\n").length <= 80000) sources.push(entry);
		}
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
