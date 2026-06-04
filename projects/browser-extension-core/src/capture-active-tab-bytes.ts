const MAX_BYTES = 500 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;

export type CapturedContent = { bytes: ArrayBuffer; mediaType: string };

/**
 * Best-effort byte capture from the user's browser context. Fires only
 * when the HTML content-script capture returned empty (the typical signal
 * that the tab isn't a DOM page — e.g. a native PDF viewer). The fetch
 * uses the user's session cookies and real TLS fingerprint via activeTab,
 * so bot-defended origins accept it where a server-side crawl gets
 * rejected. Returns bytes + the observed Content-Type so the server can
 * dispatch by media type. Any failure (network error, missing content-type,
 * oversize) returns undefined and the caller falls back to the URL-only
 * save-article path.
 */
export async function captureActiveTabBytes(
	tabUrl: string,
	fetchFn: typeof fetch,
): Promise<CapturedContent | undefined> {
	try {
		if (!tabUrl.startsWith("http://") && !tabUrl.startsWith("https://")) return undefined;
		const response = await fetchFn(tabUrl, {
			credentials: "include",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const rawContentType = response.headers.get("content-type") ?? "";
		const mediaType = rawContentType.split(";")[0].trim();
		if (!mediaType) return undefined;
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return undefined;
		return { bytes: buffer, mediaType };
	} catch {
		return undefined;
	}
}
