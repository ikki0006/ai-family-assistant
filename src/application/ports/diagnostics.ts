export type FailureCode =
	| "line_not_configured"
	| "invalid_signature"
	| "invalid_payload"
	| "reply_failed"
	| "line_api_failed"
	| "line_transport_failed"
	| "internal_error";

export interface Diagnostics {
	failure(code: FailureCode, upstreamStatus?: number): void;
}
