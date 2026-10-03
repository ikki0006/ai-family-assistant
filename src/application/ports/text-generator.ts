export interface TextGenerator {
	generate(text: string): Promise<string>;
}
