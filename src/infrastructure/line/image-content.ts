import {
	type ImageContent,
	ImageContentError,
	type ImageContentReader,
} from "../../application/ports/image-content";
const MAX_BYTES = 8 * 1024 * 1024;
export function createLineImageReader(
	token: string,
	fetcher: typeof fetch = fetch,
): ImageContentReader {
	return {
		async read(id) {
			if (!/^[0-9]{1,64}$/.test(id)) throw new ImageContentError("unavailable");
			const response = await fetcher(`https://api-data.line.me/v2/bot/message/${id}/content`, {
				headers: { Authorization: `Bearer ${token}` },
				redirect: "manual",
				signal: AbortSignal.timeout(15000),
			});
			if (!response.ok || !response.body) throw new ImageContentError("unavailable");
			const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
			if (!["image/jpeg", "image/png", "image/webp"].includes(mime ?? "")) {
				await response.body.cancel();
				throw new ImageContentError("unsupported");
			}
			if (Number(response.headers.get("content-length")) > MAX_BYTES) {
				await response.body.cancel();
				throw new ImageContentError("too_large");
			}
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > MAX_BYTES) {
						await reader.cancel();
						throw new ImageContentError("too_large");
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const c of chunks) {
				bytes.set(c, offset);
				offset += c.length;
			}
			const png =
				bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
			const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
			const webp =
				bytes.length >= 12 &&
				String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
				String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
			if (
				!(
					(mime === "image/png" && png) ||
					(mime === "image/jpeg" && jpeg) ||
					(mime === "image/webp" && webp)
				)
			)
				throw new ImageContentError("unsupported");
			let binary = "";
			for (let i = 0; i < bytes.length; i += 8192)
				binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
			return { mimeType: mime as ImageContent["mimeType"], data: btoa(binary) };
		},
	};
}
