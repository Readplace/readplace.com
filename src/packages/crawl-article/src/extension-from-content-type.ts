export function extensionFromContentType(params: { contentType: string; url: string }): string {
	const { contentType, url } = params;
	const mimeMap: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
		"image/avif": ".avif",
	};
	const mimeBase = contentType.split(";")[0].trim().toLowerCase();
	if (mimeMap[mimeBase]) return mimeMap[mimeBase];
	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
		if (match) return `.${match[1].toLowerCase()}`;
	} catch {
		// malformed URL
	}
	return ".bin";
}
