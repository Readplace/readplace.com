export const READER_SCHEME = "reader";

const READER_PREFIX = `${READER_SCHEME}://`;
const READER_PROTOCOL = `${READER_SCHEME}:`;

/**
 * The custom-scheme URL the embedded webview loads to display an article in
 * reader view. The real article URL rides in the `u` query parameter, so the
 * protocol handler — and Chromium's own session history — can round-trip it,
 * which is what gives Back/Forward/Reload across reader pages for free.
 */
export function toReaderUrl(articleUrl: string): string {
	return `${READER_PREFIX}page/?u=${encodeURIComponent(articleUrl)}`;
}

export function isReaderUrl(location: string): boolean {
	return location.startsWith(READER_PREFIX);
}

export function articleUrlFromReaderUrl(readerUrl: string): string | undefined {
	const parsed = tryParseUrl(readerUrl);
	if (!parsed || parsed.protocol !== READER_PROTOCOL) return undefined;
	return parsed.searchParams.get("u") ?? undefined;
}

/**
 * What the address bar should show for whatever the webview currently displays:
 * the underlying article URL for reader pages, the raw location otherwise.
 */
export function displayUrlFor(location: string): string {
	return articleUrlFromReaderUrl(location) ?? location;
}

function tryParseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
