import { createHash } from "node:crypto";
import type {
	ComprehensiveCrawlProgress,
	CrawlArticle,
	CrawlArticleResult,
} from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { extractThumbnailCandidates, initFetchThumbnailImage } from "./extract-thumbnail";
import { headerOrUndefined } from "./header-utils";
import { initLogFetchFailure } from "./log-fetch-failure";
import { classifyMediaType } from "./media-type";
import { parseImageFromBuffer } from "./parse-image";
import { parsePlainTextFromBuffer } from "./parse-plain-text";
import { MAX_PDF_BYTES } from "./pdf-page-limits";
import { readBodyWithCap } from "./read-capped-body";
import type { ExtractPdf } from "./pdf-extract.types";
import type { SiteCrawlOutcome, SiteRules } from "@packages/site-rules";

/**
 * Split fetch budgets: time-to-headers and body-materialisation are separate
 * failure modes. A single wall-clock signal over both meant the body read
 * competed with body size — a healthy 14 MB PDF needs ~50 s at observed
 * Lambda-to-origin throughput (~0.3 MB/s), so it could never fit the old
 * 30 s combined budget no matter how fast the origin responded. Headers stay
 * tight so dead or blocking origins still fail fast; the body budget scales
 * to the largest fetchable documents while staying under the tier-1 Lambda's
 * 240 s timeout (30 + 180 = 210 s worst case).
 */
const DEFAULT_FETCH_TIMEOUTS = { headersMs: 30000, bodyMs: 180000 } as const;

type FetchTimeouts = { headersMs: number; bodyMs: number };

/**
 * Mirrors the reason `AbortSignal.timeout()` aborts with: h2-fetch's
 * `shouldTryFallback` only proceeds past an aborted signal when
 * `reason instanceof Error && reason.name === "TimeoutError"`, so the manual
 * aborts here must keep that shape or timeouts stop falling back to curl.
 * A plain `Error` rather than `DOMException` because platform-constructed
 * DOMExceptions come from the host realm — under jest's sandbox they fail
 * `instanceof Error` and silently disable the fallback chain.
 */
function fetchTimeoutReason(message: string): Error {
	const reason = new Error(message);
	reason.name = "TimeoutError";
	return reason;
}

function describeEdgeHeaders(headers: Headers): string {
	const parts: string[] = [];
	for (const name of ["server", "cf-mitigated", "cf-ray", "retry-after"]) {
		const value = headers.get(name);
		if (value !== null) parts.push(`${name}=${value}`);
	}
	return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

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
 * the caller never has to catch; failures are already logged.
 */
function initConditionalGet(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
	fetchTimeouts: FetchTimeouts;
}): (params: {
	url: string;
	etag?: string;
	lastModified?: string;
}) => Promise<
	| { status: "ok"; response: Response; buffer: Buffer }
	| { status: "not-modified" }
	| { status: "failed" }
	| { status: "not-found"; httpStatus: 404 | 410 }
> {
	const { crawlFetch, logError, logInfo, fetchTimeouts } = deps;
	const logFetchFailure = initLogFetchFailure({ logError, logInfo });
	return async (params) => {
		/* One AbortController spans both phases because undici ties the request
		 * signal to the response body stream — aborting it is the only way to
		 * cancel an in-flight body read. AbortSignal.timeout() can't express
		 * this: it fires at a fixed wall-clock point regardless of which phase
		 * the fetch is in, which is exactly the coupling being removed. */
		const controller = new AbortController();
		let budgetTimer = setTimeout(() => {
			controller.abort(fetchTimeoutReason(`no response headers within ${fetchTimeouts.headersMs}ms`));
		}, fetchTimeouts.headersMs);
		try {
			const headers: Record<string, string> = {};
			if (params.etag) headers["if-none-match"] = params.etag;
			if (params.lastModified) headers["if-modified-since"] = params.lastModified;
			const response = await crawlFetch(params.url, {
				signal: controller.signal,
				headers,
			});
			clearTimeout(budgetTimer);
			if (response.status === 304) {
				return { status: "not-modified" };
			}
			if (response.status === 404 || response.status === 410) {
				logFetchFailure({
					status: response.status,
					message: `[CrawlArticle] HTTP ${response.status} for ${params.url}${describeEdgeHeaders(response.headers)}`,
				});
				return { status: "not-found", httpStatus: response.status };
			}
			if (!response.ok) {
				logFetchFailure({
					status: response.status,
					message: `[CrawlArticle] HTTP ${response.status} for ${params.url}${describeEdgeHeaders(response.headers)}`,
				});
				return { status: "failed" };
			}
			budgetTimer = setTimeout(() => {
				controller.abort(fetchTimeoutReason(`body not fully read within ${fetchTimeouts.bodyMs}ms`));
			}, fetchTimeouts.bodyMs);
			/* c8 ignore next -- V8 async continuation phantom on the await, see bcoe/c8#319 */
			const buffer = await readBodyWithCap(response, MAX_PDF_BYTES.bytes);
			clearTimeout(budgetTimer);
			return { status: "ok", response, buffer };
		} catch (error) {
			clearTimeout(budgetTimer);
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
	bodyHash: string;
	response: Response;
	url: string;
	fetchThumbnail?: boolean;
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
}): Promise<CrawlArticleResult> {
	const { buffer, bodyHash, response, url, fetchThumbnail, crawlFetch, logError, logInfo } = input;
	const html = new TextDecoder().decode(buffer);
	const candidates = extractThumbnailCandidates({ html, baseUrl: url });
	const thumbnailUrl = candidates[0];
	const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError, logInfo });
	const thumbnailImage = fetchThumbnail
		? await fetchThumbnailImage({ candidates, referer: url })
		: undefined;
	const result: CrawlArticleResult & { status: "fetched" } = {
		status: "fetched",
		html,
		etag: headerOrUndefined(response.headers, "etag"),
		lastModified: headerOrUndefined(response.headers, "last-modified"),
		bodyHash,
	};
	if (response.url) result.finalUrl = response.url;
	if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
	if (thumbnailImage) result.thumbnailImage = thumbnailImage;
	return result;
}

/**
 * PDF body → article result. Enforces the byte-size cap before handing the
 * buffer to the extractor (each extraction can hold a worker for as long as
 * pdfjs needs to walk the document). Extraction failure and oversize bodies
 * both surface as `unsupported` so the caller can flip the row terminal.
 *
 * `response` is optional so callers handling client-uploaded PDF bytes (no
 * HTTP fetch round-trip, e.g. the save-link-raw-pdf Lambda) can pass
 * `undefined` — the resulting `etag` / `last-modified` validators are simply
 * dropped from the result.
 */
export async function parsePdfFromBuffer(input: {
	buffer: Buffer;
	bodyHash: string;
	response: Response | undefined;
	url: string;
	maxPdfBytes: number;
	extractPdf: ExtractPdf;
	onProgress?: ComprehensiveCrawlProgress;
	logError: (message: string, error?: Error) => void;
}): Promise<CrawlArticleResult> {
	if (input.buffer.length > input.maxPdfBytes) {
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
		bodyHash: input.bodyHash,
	};
	return result;
}

/**
 * The single crawl orchestrator. One conditional GET per invocation; the body
 * is materialised once, `classifyMediaType` (the single source of truth for
 * supported media types) maps it to a `SupportedMediaType`, and the exhaustive
 * switch below dispatches to a parser:
 *
 *   - X/Twitter URLs bypass the article fetch entirely (oembed has the text).
 *   - HTML → `parseHtmlFromBuffer`.
 *   - PDF (content-type or magic-byte sniff) → `parsePdfFromBuffer`, but only
 *     when an `extractPdf` was supplied. Lambdas that defer PDF extraction
 *     construct this without `extractPdf`, so a PDF body returns `unsupported`
 *     and the save-link orchestrator hands the URL to the comprehensive Lambda.
 *   - Plain text → `parsePlainTextFromBuffer` (wrapped as minimal HTML).
 *   - Image → `parseImageFromBuffer` (bytes carried for the finalizer to host;
 *     tagged `mediaType:"image"` so the finalizer skips Readability).
 *   - Unrecognised content type → `unsupported`.
 *
 * Adding a media type is a one-line edit to `MEDIA_TYPE_MATCHERS`; the new
 * member then fails to compile in the switch until it is handled here.
 */
export function initCrawlArticle(deps: {
	crawlFetch: CrawlFetch;
	siteRules: readonly SiteRules[];
	extractPdf?: ExtractPdf;
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
	/** Test seam: production callers take the defaults; tests inject
	 * millisecond-scale budgets so the timer-abort paths run for real. */
	fetchTimeouts?: FetchTimeouts;
}): CrawlArticle {
	const { crawlFetch, siteRules, extractPdf, logError, logInfo } = deps;
	const fetchTimeouts = deps.fetchTimeouts ?? DEFAULT_FETCH_TIMEOUTS;
	const conditionalGet = initConditionalGet({ crawlFetch, logError, logInfo, fetchTimeouts });
	return async (params) => {
		let hostname: string;
		try {
			hostname = new URL(params.url).hostname;
		} catch {
			logError(`[CrawlArticle] Invalid URL ${params.url}`);
			return { status: "failed" };
		}
		/* Site-specific crawl override: the first matching site whose `onCrawl`
		 * returns content (e.g. X/Twitter oembed) or fails closed wins; `skip`
		 * falls through to the normal fetch cascade below. */
		for (const site of siteRules) {
			let claimed: boolean;
			try {
				claimed = site.matches({ url: params.url, hostname });
			} catch (error) {
				logError(
					`[CrawlArticle] Site matches threw for ${params.url}`,
					error instanceof Error ? error : undefined,
				);
				continue;
			}
			if (!claimed) continue;
			let outcome: SiteCrawlOutcome;
			try {
				outcome = await site.onCrawl({ url: params.url });
			} catch (error) {
				logError(
					`[CrawlArticle] Site onCrawl threw for ${params.url}`,
					error instanceof Error ? error : undefined,
				);
				return { status: "failed" };
			}
			if (outcome.kind === "skip") continue;
			if (outcome.kind === "failed") return { status: "failed" };
			return {
				status: "fetched",
				html: outcome.html,
				bodyHash: createHash("sha256").update(outcome.html).digest("hex"),
			};
		}
		const fetched = await conditionalGet(params);
		if (fetched.status !== "ok") return fetched;
		const { response, buffer } = fetched;
		/* Pre-parse byte gate: many origins ignore conditional headers and
		 * return 200 OK even when the body is byte-identical to the previous
		 * fetch (static-file hosts, asset CDNs that strip validators,
		 * dynamic-print services). Hashing the body before dispatch lets the
		 * caller short-circuit without paying the parse cost — for PDFs that
		 * means saving tens of seconds of mupdf walking the document. */
		const bodyHash = createHash("sha256").update(buffer).digest("hex");
		if (params.previousBodyHash && params.previousBodyHash === bodyHash) {
			return { status: "not-modified" };
		}
		const contentType = response.headers.get("content-type") ?? "";
		const mediaType = classifyMediaType({ contentType, buffer });
		if (mediaType === undefined) {
			logError(`[CrawlArticle] Unsupported content-type "${contentType}" for ${params.url}`);
			return { status: "unsupported", reason: `unsupported content type: ${contentType}` };
		}
		switch (mediaType) {
			case "html":
				return parseHtmlFromBuffer({
					buffer,
					bodyHash,
					response,
					url: params.url,
					fetchThumbnail: params.fetchThumbnail,
					crawlFetch,
					logError,
					logInfo,
				});
			case "pdf":
				if (!extractPdf) {
					logInfo(`[CrawlArticle] PDF deferred to comprehensive crawl (no extractPdf in this runtime) for ${params.url}`);
					return { status: "unsupported", reason: `unsupported content type: ${contentType}` };
				}
				return parsePdfFromBuffer({
					buffer,
					bodyHash,
					response,
					url: params.url,
					maxPdfBytes: MAX_PDF_BYTES.bytes,
					extractPdf,
					onProgress: params.onProgress,
					logError,
				});
			case "plain-text":
				return parsePlainTextFromBuffer({ buffer, bodyHash, response, url: params.url });
			case "image":
				return parseImageFromBuffer({
					buffer,
					bodyHash,
					response,
					url: params.url,
					contentType,
					logError,
				});
		}
	};
}
