import { parseHTML } from "linkedom";
import type {
	ComprehensiveCrawl,
	CrawlArticle,
	CrawlArticleResult,
	SimpleCrawl,
	ThumbnailImage,
} from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { extensionFromContentType } from "./extension-from-content-type";
import { headerOrUndefined } from "./header-utils";
import { isPdfContentType, isPdfMagicBytes } from "./pdf-detect";
import type { ExtractPdf } from "./pdf-extract.types";
import { initFetchTweetViaOembed, isTweetUrl } from "./x-twitter-preprocessor";

const FETCH_TIMEOUT_MS = 10000;
const THUMBNAIL_FETCH_TIMEOUT_MS = 5000;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Browser-like headers required by Fastly/Cloudflare edge sniffers.
 * Medium returns 403 without both User-Agent AND Accept-Language.
 *
 * Kept as the FIRST persona in CRAWL_PERSONAS for back-compat with sources
 * that have always been fetched with this exact header set. New entries
 * should be added to CRAWL_PERSONAS, not here.
 */
export const DEFAULT_CRAWL_HEADERS = {
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"accept-language": "en-US,en;q=0.9",
} as const;

/**
 * Ordered list of personas the fetcher iterates through on a block-class
 * response/error. Each persona is a coherent header set that together looks
 * like a single client to the origin — never partial impersonation, since
 * inconsistent fingerprints are themselves a bot signal (Adobe RSTs Chrome-UA
 * requests that omit Sec-Fetch-* and sec-ch-ua-* headers).
 *
 * Order matters: keep the persona that the existing canary sources have
 * always passed under at index 0 so the status quo is preserved. New
 * personas land at the end; the wrapper tries them only when earlier
 * personas hit a block-class outcome.
 *
 * 1. `default-browser` — same headers existing sources already pass under.
 *    Adds Sec-Fetch-* / sec-ch-ua-* / Upgrade-Insecure-Requests so the
 *    fingerprint is internally consistent (a "real Chrome navigating to a
 *    document"). Coherent fingerprint lets Akamai BotManager (USDA-class)
 *    through; the partial-Chrome shape it replaces was the actual trigger
 *    for Adobe-class RSTs.
 * 2. `honest-bot` — `ReadplaceBot/1.0` UA + an `Accept: *\/*` header. For
 *    origins that explicitly allow disclosed bots and reject any browser-
 *    shaped client they can't fingerprint (verified: Adobe accepts this;
 *    default-curl UA also works but ReadplaceBot is the polite-bot signal).
 */
export const CRAWL_PERSONAS = [
	{
		name: "default-browser",
		headers: {
			...DEFAULT_CRAWL_HEADERS,
			"sec-ch-ua":
				'"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
			"sec-ch-ua-mobile": "?0",
			"sec-ch-ua-platform": '"macOS"',
			"sec-fetch-dest": "document",
			"sec-fetch-mode": "navigate",
			"sec-fetch-site": "none",
			"sec-fetch-user": "?1",
			"upgrade-insecure-requests": "1",
		},
	},
	{
		name: "honest-bot",
		headers: {
			"user-agent":
				"Mozilla/5.0 (compatible; ReadplaceBot/1.0; +https://readplace.com/bot)",
			accept: "*/*",
		},
	},
] as const;

function initConditionalFetch(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: {
	url: string;
	etag?: string;
	lastModified?: string;
}) => Promise<
	| { ok: true; response: Response }
	| { ok: false; result: CrawlArticleResult }
> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		const headers: Record<string, string> = {};
		if (params.etag) headers["if-none-match"] = params.etag;
		if (params.lastModified) headers["if-modified-since"] = params.lastModified;
		const response = await crawlFetch(params.url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers,
		});
		if (response.status === 304) {
			return { ok: false, result: { status: "not-modified" } };
		}
		if (!response.ok) {
			logError(`[CrawlArticle] HTTP ${response.status} for ${params.url}`);
			return { ok: false, result: { status: "failed" } };
		}
		return { ok: true, response };
	};
}

/**
 * Simple-path crawler: HTML body + oembed for X/Twitter, plus thumbnail
 * extraction. Bails early with `{ status: "unsupported" }` on any content type
 * it doesn't handle — the orchestrator decides whether to pass the URL to
 * `initComprehensiveCrawl` for further extraction.
 */
export function initSimpleCrawl(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SimpleCrawl {
	const { crawlFetch, logError } = deps;
	const conditionalFetch = initConditionalFetch({ crawlFetch, logError });
	const fetchTweetViaOembed = initFetchTweetViaOembed({ crawlFetch, logError });
	return async (params) => {
		if (isTweetUrl(params.url)) {
			return fetchTweetViaOembed(params);
		}

		try {
			const outcome = await conditionalFetch(params);
			if (!outcome.ok) return outcome.result;
			const { response } = outcome;
			const contentType = response.headers.get("content-type") ?? "";
			if (!isHtmlContentType(contentType)) {
				logError(`[CrawlArticle] Unexpected Content-Type "${contentType}" for ${params.url}`);
				return { status: "unsupported", reason: `non-html content type: ${contentType}` };
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
			logError(`[CrawlArticle] Network error for ${params.url}`, error instanceof Error ? error : undefined);
			return { status: "failed" };
		}
	};
}

/**
 * Comprehensive-path crawler: fetches and extracts PDF documents. Each call
 * holds the worker for as long as pdfjs needs to walk the document, so this
 * factory is kept separate from the simple HTML path — the save-link
 * orchestrator only invokes it after the simple factory has identified a PDF.
 *
 * Non-PDF content from this factory is `unsupported` (the simple factory
 * already covers HTML); used standalone it cannot decide what to do with
 * arbitrary bodies and the orchestrator pattern owns that decision.
 */
export function initComprehensiveCrawl(deps: {
	crawlFetch: CrawlFetch;
	extractPdf: ExtractPdf;
	logError: (message: string, error?: Error) => void;
}): ComprehensiveCrawl {
	const { crawlFetch, extractPdf, logError } = deps;
	const conditionalFetch = initConditionalFetch({ crawlFetch, logError });
	return async (params) => {
		try {
			const outcome = await conditionalFetch(params);
			if (!outcome.ok) return outcome.result;
			const { response } = outcome;
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const contentType = response.headers.get("content-type") ?? "";
			if (isPdfContentType(contentType) || isPdfMagicBytes(buffer)) {
				return handlePdfBuffer({
					buffer,
					response,
					url: params.url,
					extractPdf,
					logError,
					onPdfPage: params.onPdfPage,
				});
			}
			logError(`[CrawlArticle] Comprehensive crawl invoked on non-pdf "${contentType}" for ${params.url}`);
			return { status: "unsupported", reason: `non-pdf content type: ${contentType}` };
		} catch (error) {
			logError(`[CrawlArticle] Network error for ${params.url}`, error instanceof Error ? error : undefined);
			return { status: "failed" };
		}
	};
}

/**
 * Composed crawler: runs the simple factory first and falls through to the
 * comprehensive factory when the simple factory reports `unsupported`. Callers
 * that need to observe the boundary between the two halves (e.g. the save-link
 * orchestrator marking a stage) should construct `initSimpleCrawl` and
 * `initComprehensiveCrawl` directly and compose the fall-through themselves.
 */
export function initCrawlArticle(deps: {
	simpleCrawl: SimpleCrawl;
	comprehensiveCrawl: ComprehensiveCrawl;
}): CrawlArticle {
	return async (params) => {
		const simpleResult = await deps.simpleCrawl(params);
		if (simpleResult.status === "unsupported") {
			return deps.comprehensiveCrawl(params);
		}
		return simpleResult;
	};
}

async function handlePdfBuffer(args: {
	buffer: Buffer;
	response: Response;
	url: string;
	extractPdf: ExtractPdf;
	logError: (message: string, error?: Error) => void;
	onPdfPage?: (params: { pageIndex: number; pageCount: number }) => void;
}): Promise<CrawlArticleResult> {
	if (args.buffer.length > MAX_PDF_BYTES) {
		args.logError(`[CrawlArticle] PDF body too large (${args.buffer.length} bytes) for ${args.url}`);
		return { status: "unsupported", reason: `pdf body too large: ${args.buffer.length} bytes` };
	}
	const extracted = await args.extractPdf({
		buffer: args.buffer,
		url: args.url,
		onProgress: args.onPdfPage,
	});
	if (extracted.kind === "failed") {
		args.logError(`[CrawlArticle] PDF extraction failed for ${args.url}: ${extracted.reason}`);
		return { status: "unsupported", reason: `pdf extraction failed: ${extracted.reason}` };
	}
	const result: CrawlArticleResult & { status: "fetched" } = {
		status: "fetched",
		html: extracted.html,
		etag: headerOrUndefined(args.response.headers, "etag"),
		lastModified: headerOrUndefined(args.response.headers, "last-modified"),
	};
	return result;
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
