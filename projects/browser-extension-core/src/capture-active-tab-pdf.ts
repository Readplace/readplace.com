const MAX_PDF_BYTES = 500 * 1024 * 1024;
const PDF_FETCH_TIMEOUT_MS = 30000;

/**
 * Best-effort PDF byte capture from the user's browser context. Fires only
 * when the HTML content-script capture returned empty (the typical signal
 * that the tab is rendering a native PDF viewer instead of a DOM). The
 * fetch uses the user's session cookies and real TLS fingerprint via
 * activeTab, so bot-defended origins (CIA Reading Room, Adobe DAM, Fastly-
 * fronted PDFs) accept it where a server-side crawl gets rejected. Any
 * failure (network error, non-PDF, oversize) returns undefined and
 * the caller falls back to the URL-only save-article path.
 */
export async function captureActiveTabPdf(
	tabUrl: string,
	fetchFn: typeof fetch,
): Promise<ArrayBuffer | undefined> {
	try {
		const response = await fetchFn(tabUrl, {
			credentials: "include",
			signal: AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const contentType = response.headers.get("content-type") ?? "";
		const isPdfContentType =
			contentType.includes("application/pdf") ||
			contentType.includes("application/x-pdf");
		if (!isPdfContentType) return undefined;
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return undefined;
		return buffer;
	} catch {
		return undefined;
	}
}
