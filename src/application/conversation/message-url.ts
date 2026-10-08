// Read only links actually present in the new message, never URLs invented by the model.
export function messageUrls(text: string): string[] {
	return [
		...new Set(
			(text.match(/https?:\/\/[^\s<>「」『』]+/gi) ?? []).map((s) =>
				s.replace(/[。、！？!?）)]+$/, ""),
			),
		),
	];
}
export function isBareUrl(text: string): boolean {
	const urls = messageUrls(text);
	return urls.length === 1 && text.trim() === urls[0];
}
