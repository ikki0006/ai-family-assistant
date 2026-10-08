export interface ImageContent {
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	data: string;
}
export interface ImageContentReader {
	read(messageId: string): Promise<ImageContent>;
}
export class ImageContentError extends Error {
	constructor(readonly reason: "unavailable" | "too_large" | "unsupported") {
		super("Image content unavailable");
	}
}
