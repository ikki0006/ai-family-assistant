export interface WebPageReader {
	read(url: string): Promise<{ url: string; content: string }>;
}
