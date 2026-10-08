export interface WebPageReader {
	read(url: string): Promise<{ url: string; content: string }>;
}

export type PageReadFailure =
	| "unsupported"
	| "auth"
	| "limited"
	| "timeout"
	| "transport"
	| "upstream"
	| "empty"
	| "invalid_response";
export class PageReadError extends Error {
	constructor(
		readonly reason: PageReadFailure,
		readonly status?: number,
	) {
		super(`Page reading failed: ${reason}`);
	}
}
