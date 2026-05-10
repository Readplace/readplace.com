import { parseHTML } from "linkedom";
import type { CrawlArticle, CrawlArticleResult, ThumbnailImage } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { headerOrUndefined } from "./header-utils";

const FETCH_TIMEOUT_MS = 10000;
const THUMBNAIL_FETCH_TIMEOUT_MS = 5000;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/**
 * Browser-like headers required by Fastly/Cloudflare edge sniffers.
 * Medium returns 403 without both User-Agent AND Accept-Language.
 */
export const DEFAULT_CRAWL_HEADERS = {
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"accept-language": "en-US,en;q=0.9",
} as const;

const X_TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\//;

export function initCrawlArticle(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): CrawlArticle {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		if (X_TWITTER_PATTERN.test(params.url)) {
			return fetchViaOembed({ crawlFetch, logError }, params);
		}

		const headers: Record<string, string> = {};
		if (params.etag) headers["if-none-match"] = params.etag;
		if (params.lastModified) headers["if-modified-since"] = params.lastModified;

		try {
			const response = await crawlFetch(params.url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers,
			});
			if (response.status === 304) {
				return { status: "not-modified" };
			}
			if (!response.ok) {
				deps.logError(`[CrawlArticle] HTTP ${response.status} for ${params.url}`);
				return { status: "failed" };
			}
			const contentType = response.headers.get("content-type") ?? "";
			if (!isHtmlContentType(contentType)) {
				deps.logError(`[CrawlArticle] Unexpected Content-Type "${contentType}" for ${params.url}`);
				return { status: "failed" };
			}
			const html = await response.text();
			const candidates = extractThumbnailCandidates({ html, baseUrl: params.url });
			const thumbnailUrl = candidates[0];
			const thumbnailImage = params.fetchThumbnail
				? await fetchThumbnailImage({ crawlFetch, logError, candidates, referer: params.url })
				: undefined;
			const result: CrawlArticleResult & { status: "fetched" } = {
				status: "fetched",
				html,
				etag: headerOrUndefined(response.headers, "etag"),
				lastModified: headerOrUndefined(response.headers, "last-modified"),
			};
			if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
			if (thumbnailImage) result.thumbnailImage = thumbnailImage;
			return result;
		} catch (error) {
			deps.logError(`[CrawlArticle] Network error for ${params.url}`, error instanceof Error ? error : undefined);
			return { status: "failed" };
		}
	};
}

async function fetchThumbnailImage(args: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	candidates: string[];
	referer: string;
}): Promise<ThumbnailImage | undefined> {
	const { crawlFetch, logError, candidates, referer } = args;

	for (const candidateUrl of candidates) {
		const result = await tryFetchImage({ crawlFetch, logError, url: candidateUrl, referer });
		if (result) return result;
	}

	return undefined;
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

/** X/Twitter returns a JS app shell with no content. The oembed API returns the actual tweet text. */
async function fetchViaOembed(
	deps: { crawlFetch: CrawlFetch; logError: (message: string, error?: Error) => void },
	params: { url: string },
) {
	const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(params.url)}`;
	try {
		const response = await deps.crawlFetch(oembedUrl, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			deps.logError(`[CrawlArticle] oembed HTTP ${response.status} for ${params.url}`);
			return { status: "failed" } as const;
		}
		const data = await response.json() as Record<string, unknown>;
		const authorName = typeof data.author_name === "string" ? data.author_name : "";
		const embed = typeof data.html === "string" ? data.html : "";
		const html = `<html><head><title>${authorName}</title></head><body>${embed}</body></html>`;
		return { status: "fetched", html } as const;
	} catch (error) {
		deps.logError(`[CrawlArticle] oembed error for ${params.url}`, error instanceof Error ? error : undefined);
		return { status: "failed" } as const;
	}
}

function extensionFromContentType(params: { contentType: string; url: string }): string {
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
		const match = pathname.match(/\.(\w{2,5})$/);
		if (match) return `.${match[1]}`;
	} catch {
		// malformed URL
	}
	return ".bin";
}

function extractThumbnailCandidates(params: {
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

/** Accept text/html and application/xhtml+xml — both are HTML-parseable by linkedom. */
function isHtmlContentType(contentType: string): boolean {
	return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}
