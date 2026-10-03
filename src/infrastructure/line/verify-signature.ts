export function createSignatureVerifier(secret: string) {
	return async (body: ArrayBuffer, signature: string): Promise<boolean> => {
		// LINE sends a Base64-encoded 32-byte HMAC. Verify raw bytes before parsing JSON.
		if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
		const bytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		return crypto.subtle.verify("HMAC", key, bytes, body);
	};
}
