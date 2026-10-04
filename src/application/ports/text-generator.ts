export interface TextGenerator {
	generate(text: string): Promise<string>;
}

export class AiUsageLimitError extends Error {
	constructor() {
		super("AI usage limit reached");
		this.name = "AiUsageLimitError";
	}
}
