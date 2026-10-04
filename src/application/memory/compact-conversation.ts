import { contextSize } from "../conversation/build-context";
import type { ConversationSnapshot } from "../conversation/conversation";
import type { ConversationStore } from "../ports/conversation-store";
import type { TextGenerator } from "../ports/text-generator";
import { SUMMARIZE_PROMPT } from "../prompts/summarize";
export async function compactConversation(
	snapshot: ConversationSnapshot,
	store: ConversationStore,
	generator: TextGenerator,
): Promise<ConversationSnapshot> {
	if (contextSize(JSON.stringify(snapshot)) < 5000 || snapshot.messages.length < 5) return snapshot;
	const tailStart = snapshot.messages.at(-3)?.occurredAt ?? 0;
	const candidates = snapshot.messages.slice(0, -3).filter((m) => m.occurredAt < tailStart);
	const day = candidates[0]?.day;
	if (!day) return snapshot;
	const previous = snapshot.summaries.find((s) => s.day === day);
	const selected = candidates.filter(
		(m) => m.day === day && m.occurredAt > (previous?.through ?? 0),
	);
	if (selected.length < 2) return snapshot;
	const chunk = [];
	let size = contextSize(previous?.text ?? "");
	for (const message of selected) {
		size += contextSize(JSON.stringify(message));
		if (size > 12000) break;
		chunk.push(message);
	}
	const through = chunk.at(-1)?.occurredAt;
	if (!through) return snapshot;
	try {
		const summary = await generator.generate({
			system: SUMMARIZE_PROMPT,
			messages: [
				{
					role: "user",
					content: JSON.stringify({ previous: previous?.text ?? "", messages: chunk }),
				},
			],
		});
		if (contextSize(summary) > 3200) return snapshot;
		if (!(await store.saveSummary(day, summary, through, snapshot.revision))) return snapshot;
		return {
			...snapshot,
			summaries: [
				...snapshot.summaries.filter((s) => s.day !== day),
				{ day, text: summary, through },
			],
			messages: snapshot.messages.filter((m) => m.day !== day || m.occurredAt > through),
		};
	} catch {
		return snapshot;
	}
}
