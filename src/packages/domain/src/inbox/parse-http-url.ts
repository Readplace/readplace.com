export function parseHttpUrl(value: string): URL | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url;
	} catch {
		return undefined;
	}
}
