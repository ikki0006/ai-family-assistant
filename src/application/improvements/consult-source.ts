import { validChoices } from "../conversation/reply-choices";
import type { SourceRepository } from "../ports/source-repository";
import type { TextGenerator } from "../ports/text-generator";
import { sourceConsultationPrompt, sourceSelectionPrompt } from "../prompts/improvements";

export type SourceConsultation =
	| { action: "clarify"; question: string; choices: string[] }
	| { action: "improve"; specification: string };

function json(raw: string): unknown {
	return JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

function selectedPaths(raw: string, manifest: string[]): string[] {
	const paths = json(raw);
	if (
		!Array.isArray(paths) ||
		paths.length < 1 ||
		paths.length > 4 ||
		new Set(paths).size !== paths.length ||
		paths.some((p) => typeof p !== "string" || !manifest.includes(p))
	)
		throw new Error("Invalid source selection");
	return paths;
}

function consultation(
	raw: string,
	revision: string,
	paths: string[],
	propose: boolean,
): SourceConsultation {
	const value = json(raw) as Record<string, unknown> | null;
	if (
		value?.action === "clarify" &&
		typeof value.question === "string" &&
		value.question.trim().length > 0 &&
		value.question.length <= 1000
	) {
		return {
			action: "clarify",
			question: value.question,
			choices: validChoices(value.choices) ? value.choices : [],
		};
	}
	if (
		propose &&
		value?.action === "improve" &&
		typeof value.specification === "string" &&
		value.specification.trim().length >= 5 &&
		value.specification.length <= 1000
	) {
		const specification = `${value.specification}\n\n調査コミット: ${revision}\n参照: ${paths.join(", ")}`;
		if (specification.length <= 1500) return { action: "improve", specification };
	}
	throw new Error("Invalid source consultation");
}

/** Read-only investigation: it cannot approve or dispatch an improvement. */
export async function consultSource(
	request: string,
	history: string,
	propose: boolean,
	repository: SourceRepository,
	generator: TextGenerator,
): Promise<SourceConsultation> {
	try {
		const manifest = await repository.manifest();
		const selected = selectedPaths(
			await generator.generate({
				system: sourceSelectionPrompt,
				messages: [
					{ role: "user", content: JSON.stringify({ request, history, paths: manifest.paths }) },
				],
			}),
			manifest.paths,
		);
		const files = await repository.read(manifest.revision, selected);
		const raw = await generator.generate({
			system: sourceConsultationPrompt,
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						request,
						history,
						propose,
						revision: manifest.revision,
						files,
					}),
				},
			],
		});
		return consultation(raw, manifest.revision, selected, propose);
	} catch {
		return {
			action: "clarify",
			question:
				"ソースの取得・調査を完了できませんでした。現状を確認できていないため、改善案の承認には進めません。少し待って再度依頼してください。（確認コード: source_consult_failed）",
			choices: [],
		};
	}
}
