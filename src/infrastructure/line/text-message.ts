import type { QuickReply } from "../../application/ports/quick-reply";
export function textMessage(text: string, choices?: QuickReply[]) {
	if (
		choices &&
		(choices.length > 13 ||
			choices.some(
				(c) => !c.label || c.label.length > 20 || c.data.length > 300 || c.displayText.length > 300,
			))
	)
		throw new Error("Invalid quick reply");
	return {
		type: "text",
		text,
		...(choices?.length
			? {
					quickReply: {
						items: choices.map((c) => ({ type: "action", action: { type: "postback", ...c } })),
					},
				}
			: {}),
	};
}
