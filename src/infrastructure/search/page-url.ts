export function publicPageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		return (
			value.length <= 2000 &&
			["https:", "http:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			(!url.port || ["80", "443"].includes(url.port)) &&
			host.includes(".") &&
			!host.includes(":") &&
			!/^[\d.]+$/.test(host) &&
			!/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host) &&
			![...url.searchParams.keys()].some((k) =>
				/token|secret|password|signature|credential|api.?key/i.test(k),
			)
		);
	} catch {
		return false;
	}
}
