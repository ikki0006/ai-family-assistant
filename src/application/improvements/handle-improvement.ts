import type { ImprovementDispatcher, ImprovementRepository } from "../ports/improvement-repository";

export function improvementSpecification(text: string): string | null {
	const t = text.trim();
	const command = /^(?:改善|改良)[:：]\s*([\s\S]+)$/.exec(t);
	if (command) return command[1]?.trim() ?? null;
	// Proposals never dispatch. Ambiguous requests still get a confirmation first.
	if (
		/(?:改善|改良|修正|実装|変更)(?:して|してください|してほしい)/.test(t) &&
		/(?:プルリク(?:エスト)?|PR)(?:を)?(?:作|出|上げ|あげ)/i.test(t)
	)
		return t;
	return null;
}
export function isImprovementRequest(text: string): boolean {
	return improvementSpecification(text) !== null || /^改善承認(?:\s|$)/.test(text.trim());
}
export async function handleImprovement(
	input: { text: string; groupId: string; eventId: string },
	dependencies: {
		repository: ImprovementRepository;
		dispatcher: ImprovementDispatcher;
	},
): Promise<string | null> {
	const text = input.text.trim();
	const specification = improvementSpecification(text);
	if (specification !== null) {
		if (specification.length < 5 || specification.length > 2000) {
			return "改善内容は5〜2000文字で指定してください。個人情報は含めないでください。";
		}
		const request = await dependencies.repository.create(
			input.groupId,
			input.eventId,
			specification,
		);
		return `改善 #${request.id}（版 ${request.version}）\n${request.specification}\n\nこの内容をGitHubと実装AIへ渡し、アプリコード・テストの小さな変更としてDraft PRを作ります。自動mergeはしません。\n承認する場合: 改善承認 ${request.id} ${request.version}`;
	}
	const approval = /^改善承認\s+([a-f0-9-]{36})\s+(\d+)$/.exec(text);
	if (!approval) return null;
	const id = approval[1] ?? "";
	const version = Number(approval[2]);
	const request = await dependencies.repository.get(input.groupId, id);
	if (!request || request.version !== version)
		return "その改善依頼・版が見つかりません。確認メッセージのIDと版を指定してください。";
	if (!(await dependencies.repository.claim(input.groupId, id, version))) {
		return "この依頼はすでに実行依頼済みです。GitHub Actionsの実行履歴を確認してください。";
	}
	try {
		await dependencies.dispatcher.dispatch(request);
		await dependencies.repository.finish(input.groupId, id, "dispatched");
		return `改善 #${id} の実装を依頼しました。GitHub Actionsで検証後、Draft PRを作成します。失敗時はPRを作りません。`;
	} catch {
		await dependencies.repository.finish(input.groupId, id, "uncertain");
		return `改善 #${id} の実行受付を確認できませんでした。重複実行を避けるため自動再送しません。GitHub Actionsの実行履歴を確認してください。`;
	}
}
