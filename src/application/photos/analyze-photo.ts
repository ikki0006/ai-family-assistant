import { ImageContentError, type ImageContentReader } from "../ports/image-content";
import { AiUsageLimitError, type TextGenerator } from "../ports/text-generator";
import { photoPrompt } from "../prompts/photos";
export async function analyzePhoto(
	id: string,
	reader: ImageContentReader,
	generator: TextGenerator,
): Promise<string> {
	try {
		const image = await reader.read(id);
		const answer = await generator.generate({
			system: photoPrompt,
			messages: [
				{
					role: "user",
					content:
						"この写真を見て、家計情報なら整理した読み取り結果、その他の文字は文字起こし、文字のない写真は感想を返してください。",
					image,
				},
			],
		});
		return Array.from(answer).slice(0, 2000).join("");
	} catch (error) {
		if (error instanceof ImageContentError) {
			if (error.reason === "too_large")
				return "写真が大きすぎて読み取れませんでした。8MB以下にして送り直してください。";
			if (error.reason === "unsupported")
				return "この画像形式は読み取れませんでした。JPEG・PNG・WebPの写真を送り直してください。";
			return "写真を取得できませんでした。写真を送り直してください。";
		}
		if (error instanceof AiUsageLimitError)
			return "AIの残高・利用上限により、今は写真を解析できません。";
		return "今は写真を読み取れませんでした。少し待ってから、もう一度写真を送ってください。";
	}
}
