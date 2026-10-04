import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateFiles } from "./files.mjs";

function japanese(value, limit) {
	return typeof value === "string" &&
		value.trim().length <= limit &&
		/[ぁ-んァ-ヶ一-龠]/.test(value)
		? value.trim()
		: null;
}
function plain(value) {
	return [...value]
		.map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
		.join("")
		.replace(/[<>]/g, "");
}
export function describePullRequest(files, specification, id, version) {
	validateFiles(files);
	if (
		typeof specification !== "string" ||
		!specification.trim() ||
		specification.length > 2000 ||
		!/^[a-f0-9-]{36}$/.test(id) ||
		!/^\d+$/.test(version)
	)
		throw new Error("Invalid PR metadata");
	const title = plain(japanese(files[0]?.prTitle, 100) ?? `改善: ${specification}`).slice(0, 100);
	const request = specification
		.split(/\r?\n/)
		.map((line) => `> ${plain(line)}`)
		.join("\n");
	const changes = files
		.map(
			(file) =>
				`- \`${file.path}\`: ${plain(japanese(file.changeSummary, 500) ?? "承認された要望に沿って更新。詳細は差分を確認してください。")}`,
		)
		.join("\n");
	return {
		title,
		body: `## 要望\n\n${request}\n\n## 変更内容\n\n${changes}\n\n## 検証\n\n- 隔離した検証ジョブで \`pnpm verify\` が成功しました。\n- 変更理由は実装AIによる説明です。差分と動作をレビューしてからマージしてください。\n- Draft PRとして作成し、自動承認・自動マージは行いません。\n\n追跡用: 依頼 ${id} / 版 ${version}\n`,
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const result = describePullRequest(
		JSON.parse(await readFile(process.argv[2], "utf8")),
		process.env.IMPROVEMENT_SPECIFICATION,
		process.env.REQUEST_ID,
		process.env.REQUEST_VERSION,
	);
	await writeFile(process.argv[3], result.title);
	await writeFile(process.argv[4], result.body);
}
