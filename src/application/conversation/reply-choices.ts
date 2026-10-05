export function validChoices(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= 4 &&
		value.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 20) &&
		new Set(value).size === value.length
	);
}
export function parseReplyChoices(raw: string): { text: string; choices: string[] } {
	try {
		const v = JSON.parse(
			raw
				.trim()
				.replace(/^```(?:json)?\s*/, "")
				.replace(/\s*```$/, ""),
		);
		if (typeof v?.text === "string" && v.text.trim())
			return { text: v.text, choices: validChoices(v.choices) ? v.choices : [] };
	} catch {}
	return { text: raw, choices: [] };
}
