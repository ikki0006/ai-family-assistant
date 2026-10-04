import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export function allowedPath(path) {
	return (
		typeof path === "string" &&
		/^(src\/(?:application|domain|core|bootstrap|infrastructure)\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts|tests\/(?:unit|integration)\/[a-z0-9-]+\.test\.ts)$/.test(
			path,
		)
	);
}

export function validateFiles(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 5)
		throw new Error("Expected 1–5 files");
	const paths = new Set();
	for (const file of value) {
		if (
			!file ||
			typeof file.path !== "string" ||
			typeof file.content !== "string" ||
			file.content.length > 30000
		)
			throw new Error("Invalid file");
		if (!allowedPath(file.path)) throw new Error("Path outside improvement scope");
		if (paths.has(file.path)) throw new Error("Duplicate file");
		paths.add(file.path);
	}
	return value;
}

export async function applyFiles(filename) {
	const files = validateFiles(JSON.parse(await readFile(filename, "utf8")));
	const root = await realpath(".");
	for (const file of files) {
		const path = resolve(file.path);
		await mkdir(dirname(path), { recursive: true });
		if (!(await realpath(dirname(path))).startsWith(`${root}${sep}`))
			throw new Error("Unsafe directory");
		const existing = await lstat(path).catch(() => null);
		if (existing && !existing.isFile()) throw new Error("Unsafe target");
		await writeFile(path, file.content);
	}
}
