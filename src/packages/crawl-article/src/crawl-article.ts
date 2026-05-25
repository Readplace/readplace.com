import type {
	ComprehensiveCrawlProgress,
	CrawlArticle,
	CrawlArticleResult,
} from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { extractThumbnailCandidates, initFetchThumbnailImage } from "./extract-thumbnail";
import { headerOrUndefined } from "./header-utils";
import { isPDF } from "./pdf-detect";
import { MAX_PDF_BYTES } from "./pdf-page-limits";
import type { ExtractPdf } from "./pdf-extract.types";
import { initFetchTweetViaOembed, isTweetUrl } from "./x-twitter-preprocessor";

const FETCH_TIMEOUT_MS = 10000;

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

/**
 * One conditional GET against the origin, with the body materialised into a
 * Buffer so the orchestrator can dispatch on content-type without a second
 * round-trip. Sends `If-None-Match` / `If-Modified-Since` when the caller has
 * cached validators. All failure modes collapse to a discriminated result —
 * the caller never has to catch: `not-modified` (304), `failed` (non-2xx or
 * network error, already logged), or `ok` (2xx with the response + bytes).
 */
function initConditionalGet(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: {
	url: string;
	etag?: string;
	lastModified?: string;
}) => Promise<
	| { status: "ok"; response: Response; buffer: Buffer }
	| { status: "not-modified" }
	| { status: "failed" }
> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		try {
			const headers: Record<string, string> = {};
			if (params.etag) headers["if-none-match"] = params.etag;
			if (params.lastModified) headers["if-modified-since"] = params.lastModified;
			const response = await crawlFetch(params.url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers,
			});
			if (response.status === 304) {
				return { status: "not-modified" };
			}
			if (!response.ok) {
				logError(`[CrawlArticle] HTTP ${response.status} for ${params.url}`);
				return { status: "failed" };
			}
			return { status: "ok", response, buffer: Buffer.from(await response.arrayBuffer()) };
		} catch (error) {
			logError(`[CrawlArticle] Network error for ${params.url}`, error instanceof Error ? error : undefined);
			return { status: "failed" };
		}
	};
}

/**
 * HTML body → article result. Decodes the materialised buffer (UTF-8, matching
 * `Response.text()`), extracts thumbnail candidates, and — when `fetchThumbnail`
 * is set — prefetches the first candidate that downloads cleanly so callers
 * never fire a second image request. `etag` / `last-modified` ride through from
 * the response so the caller can persist conditional validators.
 */
export async function parseHtmlFromBuffer(input: {
	buffer: Buffer;
	response: Response;
	url: string;
	fetchThumbnail?: boolean;
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): Promise<CrawlArticleResult> {
	const { buffer, response, url, fetchThumbnail, crawlFetch, logError } = input;
	const html = new TextDecoder().decode(buffer);
	const candidates = extractThumbnailCandidates({ html, baseUrl: url });
	const thumbnailUrl = candidates[0];
	const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError });
	const thumbnailImage = fetchThumbnail
		? await fetchThumbnailImage({ candidates, referer: url })
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
}

/**
 * PDF body → article result. Enforces the byte-size cap before handing the
 * buffer to the extractor (each extraction can hold a worker for as long as
 * pdfjs needs to walk the document). Extraction failure and oversize bodies
 * both surface as `unsupported` so the caller can flip the row terminal.
 */
export async function parsePdfFromBuffer(input: {
	buffer: Buffer;
	response: Response | undefined;
	url: string;
	extractPdf: ExtractPdf;
	onProgress?: ComprehensiveCrawlProgress;
	logError: (message: string, error?: Error) => void;
}): Promise<CrawlArticleResult> {
	if (input.buffer.length > MAX_PDF_BYTES.bytes) {
		input.logError(`[CrawlArticle] PDF body too large (${input.buffer.length} bytes) for ${input.url}`);
		return { status: "unsupported", reason: `pdf body too large: ${input.buffer.length} bytes` };
	}
	const extracted = await input.extractPdf({
		buffer: input.buffer,
		url: input.url,
		onProgress: input.onProgress,
	});
	if (extracted.kind === "failed") {
		input.logError(`[CrawlArticle] PDF extraction failed for ${input.url}: ${extracted.reason}`);
		return { status: "unsupported", reason: `pdf extraction failed: ${extracted.reason}` };
	}
	const result: CrawlArticleResult & { status: "fetched" } = {
		status: "fetched",
		html: extracted.html,
		etag: input.response ? headerOrUndefined(input.response.headers, "etag") : undefined,
		lastModified: input.response
			? headerOrUndefined(input.response.headers, "last-modified")
			: undefined,
	};
	return result;
}

/**
 * The single crawl orchestrator. One conditional GET per invocation; the body
 * is materialised once and dispatched on content-type:
 *
 *   - X/Twitter URLs bypass the article fetch entirely (oembed has the text).
 *   - HTML → `parseHtmlFromBuffer`.
 *   - PDF (content-type or magic-byte sniff) → `parsePdfFromBuffer`, but only
 *     when an `extractPdf` was supplied. Lambdas that defer PDF extraction
 *     construct this without `extractPdf`, so a PDF body returns `unsupported`
 *     and the save-link orchestrator hands the URL to the comprehensive Lambda.
 *   - Anything else → `unsupported`.
 */
export function initCrawlArticle(deps: {
	crawlFetch: CrawlFetch;
	extractPdf?: ExtractPdf;
	logError: (message: string, error?: Error) => void;
}): CrawlArticle {
	const { crawlFetch, extractPdf, logError } = deps;
	const conditionalGet = initConditionalGet({ crawlFetch, logError });
	const fetchTweetViaOembed = initFetchTweetViaOembed({ crawlFetch, logError });
	return async (params) => {
		if (isTweetUrl(params.url)) {
			return fetchTweetViaOembed({ url: params.url });
		}
		const fetched = await conditionalGet(params);
		if (fetched.status !== "ok") return fetched;
		const { response, buffer } = fetched;
		const contentType = response.headers.get("content-type") ?? "";
		if (isHtmlContentType(contentType)) {
			return parseHtmlFromBuffer({
				buffer,
				response,
				url: params.url,
				fetchThumbnail: params.fetchThumbnail,
				crawlFetch,
				logError,
			});
		}
		if (extractPdf && isPDF({ contentType, bodyBytes: buffer })) {
			return parsePdfFromBuffer({
				buffer,
				response,
				url: params.url,
				extractPdf,
				onProgress: params.onProgress,
				logError,
			});
		}
		logError(`[CrawlArticle] Unsupported content-type "${contentType}" for ${params.url}`);
		return { status: "unsupported", reason: `unsupported content type: ${contentType}` };
	};
}

/** Accept text/html and application/xhtml+xml — both are HTML-parseable by linkedom. */
function isHtmlContentType(contentType: string): boolean {
	return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}
