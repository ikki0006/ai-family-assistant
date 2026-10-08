import type { Diagnostics } from "../ports/diagnostics";
import type { TextGenerator } from "../ports/text-generator";
import { PageReadError, type WebPageReader } from "../ports/web-page-reader";
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
		return failed("URLを読む設定がまだできていません。場所の名前やページの内容を教えてください。");
	if (!(await reserve()))
		return failed(
			"今月の検索・URL読み取り回数が上限に達しました。場所の名前やページの内容を教えてください。",
		);
	let page: Awaited<ReturnType<WebPageReader["read"]>>;
	try {
		page = await reader.read(url);
	} catch (error) {
		if (error instanceof PageReadError) {
			diagnostics?.failure(`page_read_${error.reason}`, error.status);
			if (error.reason === "auth")
				return failed(
					"URL読み取りサービスの認証に失敗しました。接続設定を確認する必要があります。",
				);
			if (error.reason === "limited")
				return failed(
					"URL読み取りサービスの利用上限に達しています。時間を置いて試すか、内容が見える画像を送ってください。",
				);
			if (error.reason === "timeout")
				return failed(
					"リンク先の読み取りが時間切れになりました。もう一度URLを送るか、内容が見える画像を送ってください。",
				);
		} else diagnostics?.failure("page_read_transport");
		return failed(
			"リンク先の本文を読み取れませんでした。場所の名前か、内容が見える画像を送ってもらえますか？",
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
