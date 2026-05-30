import { parseHTML } from "linkedom";
import type { CrawlFetch } from "./crawl-fetch";
import { extensionFromContentType } from "./extension-from-content-type";
import type { ThumbnailImage } from "./crawl-article.types";

const THUMBNAIL_FETCH_TIMEOUT_MS = 5000;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/**
 * Single source of truth for picking the article's thumbnail URL out of
 * an HTML document. Every entry point that wants the imageUrl metadata
 * (server-side crawl, browser-extension raw-html save, stale-check
 * refresh) MUST go through this function so the cascade stays identical
 * across paths — see CLAUDE.md product constraints on the canonical
 * `og:image` → `twitter:image` → first `<img>` order.
 */
export function extractThumbnailCandidates(params: {
	html: string;
	baseUrl?: string;
}): string[] {
	const { html, baseUrl } = params;
	const { document } = parseHTML(html);
	const seen = new Set<string>();
	const candidates: string[] = [];

	function push(raw: string | null | undefined) {
		const resolved = resolveIfRelative(raw, baseUrl);
		if (resolved && isValidHttpUrl(resolved) && !seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	}

	push(document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
	push(document.querySelector('meta[name="twitter:image"]')?.getAttribute("content"));
	for (const img of document.querySelectorAll("img[src]")) {
		push(img.getAttribute("src"));
	}

	return candidates;
}

function resolveIfRelative(
	url: string | null | undefined,
	baseUrl: string | undefined,
): string | undefined {
	if (!url) return undefined;
	if (isValidHttpUrl(url)) return url;
	if (!baseUrl) return url;
	try {
		return new URL(url, baseUrl).href;
	} catch {
		return url;
	}
}

function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export type FetchThumbnailImage = (params: {
	candidates: readonly string[];
	referer: string;
}) => Promise<ThumbnailImage | undefined>;

/**
 * Walks the candidate list and returns the first image that downloads cleanly
 * within the timeout / size / content-type bounds. Shared between the HTML
 * crawl path (`parseHtmlFromBuffer`, which prefetches inline) and any caller
 * that already has HTML in hand (raw-html save, comprehensive crawl
 * post-extract) — same algorithm, same bounds, no per-path drift.
 */
export function initFetchThumbnailImage(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): FetchThumbnailImage {
	const { crawlFetch, logError } = deps;
	return async ({ candidates, referer }) => {
		for (const candidateUrl of candidates) {
			const result = await tryFetchImage({ crawlFetch, logError, url: candidateUrl, referer });
			if (result) return result;
		}
		return undefined;
	};
}

async function tryFetchImage(args: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	url: string;
	referer: string;
}): Promise<ThumbnailImage | undefined> {
	const { crawlFetch, logError, url, referer } = args;
	try {
		const response = await crawlFetch(url, {
			signal: AbortSignal.timeout(THUMBNAIL_FETCH_TIMEOUT_MS),
			headers: { accept: "image/*,*/*;q=0.8" },
			referer,
		});
		if (!response.ok) {
			logError(`[CrawlArticle] Thumbnail HTTP ${response.status} for ${url}`);
			return undefined;
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.startsWith("image/")) {
			logError(`[CrawlArticle] Thumbnail unexpected Content-Type "${contentType}" for ${url}`);
			return undefined;
		}
		const contentLength = response.headers.get("content-length");
		if (contentLength && Number.parseInt(contentLength, 10) > MAX_THUMBNAIL_BYTES) {
			logError(`[CrawlArticle] Thumbnail too large (${contentLength} bytes) for ${url}`);
			return undefined;
		}
		const arrayBuffer = await response.arrayBuffer();
		const body = Buffer.from(arrayBuffer);
		if (body.length > MAX_THUMBNAIL_BYTES) {
			logError(`[CrawlArticle] Thumbnail too large (${body.length} bytes) for ${url}`);
			return undefined;
		}
		return { body, contentType, url, extension: extensionFromContentType({ contentType, url }) };
	} catch (error) {
		logError(`[CrawlArticle] Thumbnail network error for ${url}`, error instanceof Error ? error : undefined);
		return undefined;
	}
}
