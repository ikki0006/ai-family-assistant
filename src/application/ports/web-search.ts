export interface SearchResult {
	title: string;
	url: string;
	content: string;
}
export interface WebSearch {
	search(query: string): Promise<SearchResult[]>;
}
