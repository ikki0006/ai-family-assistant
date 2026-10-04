import type { GenerationInput } from "../conversation/conversation";

export interface TextGenerator {
	generate(input: GenerationInput): Promise<string>;
}

export class AiUsageLimitError extends Error {
	constructor() {
		super("AI usage limit reached");
		this.name = "AiUsageLimitError";
	}
}
