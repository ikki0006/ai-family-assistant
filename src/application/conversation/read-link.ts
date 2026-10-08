import type { TextGenerator } from "../ports/text-generator";
import type { WebPageReader } from "../ports/web-page-reader";
import { followupPrompt, linkPrompt } from "../prompts/links";
import { messageUrls } from "./message-url";
import { parseReplyChoices } from "./reply-choices";
export async function readLink(
	text: string,
	history: string,
	reader: WebPageReader | undefined,
	generator: TextGenerator,
	reserve: () => Promise<boolean>,
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
	} catch {
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
