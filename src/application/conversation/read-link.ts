import type { Diagnostics } from "../ports/diagnostics";
import type { TextGenerator } from "../ports/text-generator";
import { PageReadError, type PageReadFailure, type WebPageReader } from "../ports/web-page-reader";
import { followupPrompt, linkPrompt } from "../prompts/links";
import { messageUrls } from "./message-url";
import { parseReplyChoices } from "./reply-choices";
export async function readLink(
	text: string,
	history: string,
	reader: WebPageReader | undefined,
	generator: TextGenerator,
	reserve: () => Promise<boolean>,
	diagnostics?: Diagnostics,
) {
	const urls = messageUrls(text);
	const failed = (text: string) => ({ text, choices: [] as string[] });
	if (urls.length !== 1)
		return failed("URLは一つずつ送ってください。どのページを確認しましょうか？");
	const url = urls[0] ?? "";
	if (!reader)
		return failed(
			"URL読み取りサービスが未設定です。管理者がTavilyの接続設定を確認してください。\n確認コード: page_read_not_configured",
		);
	if (!(await reserve()))
		return failed(
			"このbotの今月の検索・URL読み取り回数が上限に達しました。ページの内容を文章か画像で送ってください。\n確認コード: page_read_monthly_limit",
		);
	let page: Awaited<ReturnType<WebPageReader["read"]>>;
	try {
		page = await reader.read(url);
	} catch (error) {
		const failure = error instanceof PageReadError ? error : new PageReadError("transport");
		const status =
			Number.isInteger(failure.status) &&
			Number(failure.status) >= 100 &&
			Number(failure.status) <= 599
				? failure.status
				: undefined;
		diagnostics?.failure(`page_read_${failure.reason}`, status);
		return failed(
			`${pageFailureMessages[failure.reason]}\n確認コード: page_read_${failure.reason}${status ? ` / HTTP ${status}` : ""}`,
		);
	}

	const result = parseReplyChoices(
		await generator.generate({
			system: linkPrompt,
			messages: [{ role: "user", content: JSON.stringify({ latest: text, history, page }) }],
		}),
	);
	return { text: `${result.text.slice(0, 1500)}\n参照: ${url}`, choices: result.choices };
}
export async function isQuestionReply(
	question: string,
	reply: string,
	generator: TextGenerator,
	interveningConversation = "",
): Promise<boolean> {
	try {
		const raw = await generator.generate({
			system: followupPrompt,
			messages: [
				{ role: "user", content: JSON.stringify({ question, reply, interveningConversation }) },
			],
		});
		return (
			JSON.parse(
				raw
					.trim()
					.replace(/^```(?:json)?\s*/, "")
					.replace(/\s*```$/, ""),
			)?.reply === true
		);
	} catch {
		return false;
	}
}

const pageFailureMessages: Record<PageReadFailure, string> = {
	unsupported:
		"このURLは読み取り対象外です。公開された通常のWebページのURLか、内容が見える画像を送ってください。",
	auth: "URL読み取りサービス（Tavily）の認証に失敗しました。管理者が本番WorkerのAPIキーと利用権限を確認してください。",
	limited:
		"URL読み取りサービス（Tavily）の利用制限にかかりました。管理者が残高・利用上限を確認してください。",
	timeout:
		"URL読み取りが時間切れになりました。少し待ってもう一度送るか、内容が見える画像を送ってください。",
	transport:
		"URL読み取りサービス（Tavily）との通信処理で失敗しました。ページの本文やAIの解釈に進む前のエラーです。繰り返す場合は管理者へ確認コードを伝えてください。",
	upstream:
		"URL読み取りサービス（Tavily）が正常な応答を返しませんでした。少し待って再試行し、繰り返す場合は管理者へ確認コードを伝えてください。",
	empty:
		"URL読み取りサービス（Tavily）から本文を取得できませんでした。サービスとの通信は成功しましたが、本文が空か、対象ページの抽出に失敗しています。内容が見える画像や、別の掲載元URLを送ってください。",
	invalid_response:
		"URL読み取りサービス（Tavily）から想定と異なる形式の応答が返りました。管理者が連携処理を確認する必要があります。",
};
