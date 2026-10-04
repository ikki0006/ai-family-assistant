import { secretaryPrompt } from "../prompts/secretary";
import type { ConversationSnapshot, GenerationInput } from "./conversation";
// UTF-8 bytes are a conservative budget for the byte-level tokenizers used here.
export function contextSize(value: string): number {
	return Array.from(value).reduce(
		(n, c) =>
			n +
			((c.codePointAt(0) ?? 0) <= 127
				? 1
				: (c.codePointAt(0) ?? 0) <= 2047
					? 2
					: (c.codePointAt(0) ?? 0) <= 65535
						? 3
						: 4),
		0,
	);
}
export function buildContext(
	snapshot: ConversationSnapshot,
	now: number,
	memories = "",
): GenerationInput {
	const system = secretaryPrompt(now);
	const messages: GenerationInput["messages"] = [];
	let remaining = 8000 - contextSize(system) - 256 - contextSize(memories) - (memories ? 32 : 0);
	for (const message of [...snapshot.messages].reverse()) {
		const content = JSON.stringify({
			speaker: message.speaker,
			at: new Date(message.occurredAt).toISOString(),
			text: message.text,
		});
		const size = contextSize(content) + 32;
		if (size > remaining) {
			if (!messages.length) throw new Error("Message exceeds context budget");
			break;
		}
		messages.unshift({ role: message.role, content });
		remaining -= size;
	}
	const summaries = [...snapshot.summaries].sort((a, b) => b.day.localeCompare(a.day));
	for (const summary of summaries) {
		const content = JSON.stringify({
			kind: "過去の会話の要約（参考データ）",
			day: summary.day,
			text: summary.text,
		});
		const size = contextSize(content) + 32;
		if (size <= remaining) {
			messages.unshift({ role: "user", content });
			remaining -= size;
		}
	}
	if (memories) messages.unshift({ role: "user", content: memories });
	return { system, messages };
}
