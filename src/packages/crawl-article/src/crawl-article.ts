import { createHash } from "node:crypto";
import {
	classifyFailedResponse,
	classifyFetchError,
	type FetchFailureClassification,
} from "./classify-fetch-failure";
import type {
	ComprehensiveCrawlProgress,
	CrawlArticle,
	CrawlArticleResult,
} from "./crawl-article.types";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { extractThumbnailCandidates, initFetchThumbnailImage } from "./extract-thumbnail";
import { headerOrUndefined } from "./header-utils";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { initLogFetchFailure } from "./log-fetch-failure";
import { classifyMediaType, type SupportedMediaType } from "./media-type";
import { parseImageFromBuffer } from "./parse-image";
import { parsePlainTextFromBuffer } from "./parse-plain-text";
import { MAX_PDF_BYTES } from "./pdf-page-limits";
import { isBlockClassResponse } from "./persona-fallback";
import { readBodyWithCap } from "./read-capped-body";
import { resolveDocumentUrl } from "./resolve-document-url";
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
 * timeout (30 + 180 = 210 s worst case).
 */
const DEFAULT_FETCH_TIMEOUTS = { headersMs: 30000, bodyMs: 180000 } as const;

/**
 * Timeouts for a crawler whose fetch is configured with an egress proxy. Only
 * the header budget differs: it has to seat the direct ladder and the proxied
 * second pass, where the default leaves no room for the latter. Reading the
 * body is unaffected by which egress delivered it.
 *
 * This is what sets the floor under the crawl Lambdas' timeout: 100 + 180 is a
 * 280 s worst case, so a handler running a proxied crawl needs more than the
 * 240 s an unproxied one was sized for.
 */
export const PROXIED_FETCH_TIMEOUTS = {
	headersMs: PROXIED_CRAWL_HEADERS_MILLISECONDS,
	bodyMs: DEFAULT_FETCH_TIMEOUTS.bodyMs,
} as const;

const MAX_SITE_RULE_REDIRECTS = 3;

type RefusedTerminal = Exclude<
	Awaited<ReturnType<ReturnType<typeof initConditionalGet>>>,
	{ status: "ok" }
>;

async function recoverRefusedTerminal(params: {
	fetched: RefusedTerminal;
	site: SiteRules | undefined;
	url: string;
	logInfo: (message: string) => void;
}): Promise<CrawlArticleResult> {
	const { fetched, site, url, logInfo } = params;
	if (site === undefined) return fetched;
	if (fetched.status === "not-modified") return fetched;
	const recovered = await site.recoverContent({ url });
	if (recovered === undefined) return fetched;
	logInfo(`[CrawlArticle] ${url} recovered from its ${fetched.status} terminal`);
	return {
		status: "fetched",
		html: recovered,
		bodyHash: createHash("sha256").update(recovered).digest("hex"),
		finalUrl: fetched.finalUrl,
	};
}

type FetchTimeouts = { headersMs: number; bodyMs: number };

/**
 * A plain Error named "TimeoutError": the name is uniform across every fetch
 * deadline in the crawl chain, which is what makes a production log line
 * attributable to the budget that actually ran out. Plain Error rather than
 * DOMException because a platform-constructed DOMException comes from the host
 * realm and fails `instanceof Error` under jest's sandbox, and the crawl logger
 * drops any rejection that is not an Error.
 */
function fetchTimeoutReason(message: string): Error {
	const reason = new Error(message);
	reason.name = "TimeoutError";
	return reason;
}

function terminalUrl(response: Response): string | undefined {
	return response.url || undefined;
}

/**
 * A log line that quotes edge headers must attribute them to the host that sent
 * them, not to the wrapper that redirected there.
 */
function redirectSuffix(params: { requestedUrl: string; responseUrl: string | undefined }): string {
	const { requestedUrl, responseUrl } = params;
	if (!responseUrl) return "";
	if (responseUrl === requestedUrl) return "";
	return ` → ${responseUrl}`;
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

const HTML_PARSE_BYTE_CAP = {
	html: MAX_HTML_BYTES.bytes,
	"plain-text": MAX_HTML_BYTES.bytes,
	pdf: Number.POSITIVE_INFINITY,
	image: Number.POSITIVE_INFINITY,
} satisfies Record<SupportedMediaType, number>;

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
	| { status: "failed"; finalUrl?: string; failure?: FetchFailureClassification }
	| { status: "blocked"; httpStatus: number; finalUrl?: string }
	| { status: "not-found"; httpStatus: 404 | 410; finalUrl?: string }
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
		let lastRedirectHop: string | undefined;
		let budgetTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const headers: Record<string, string> = {};
			if (params.etag) headers["if-none-match"] = params.etag;
			if (params.lastModified) headers["if-modified-since"] = params.lastModified;
			const response = await crawlFetch(params.url, {
				signal: controller.signal,
				budgetMs: fetchTimeouts.headersMs,
				headers,
				onRedirect: (hop) => {
					lastRedirectHop = hop.toUrl;
				},
			});
			if (response.status === 304) {
				return { status: "not-modified" };
			}
			const finalUrl = terminalUrl(response);
			const suffix = redirectSuffix({ requestedUrl: params.url, responseUrl: finalUrl });
			if (response.status === 404 || response.status === 410) {
				logFetchFailure({
					status: response.status,
					message: `[CrawlArticle] HTTP ${response.status} for ${params.url}${suffix}${describeEdgeHeaders(response.headers)}`,
				});
				return { status: "not-found", httpStatus: response.status, finalUrl };
			}
			if (!response.ok) {
				logFetchFailure({
					status: response.status,
					message: `[CrawlArticle] HTTP ${response.status} for ${params.url}${suffix}${describeEdgeHeaders(response.headers)}`,
				});
				if (isBlockClassResponse(response) || response.status === 429) {
					return { status: "blocked", httpStatus: response.status, finalUrl };
				}
				return { status: "failed", finalUrl, failure: classifyFailedResponse({ httpStatus: response.status }) };
			}
			budgetTimer = setTimeout(() => {
				controller.abort(fetchTimeoutReason(`body not fully read within ${fetchTimeouts.bodyMs}ms`));
			}, fetchTimeouts.bodyMs);
			const buffer = await readBodyWithCap(response, MAX_PDF_BYTES.bytes);
			/* c8 ignore next -- V8 async continuation phantom on the await above, see bcoe/c8#319 */
			clearTimeout(budgetTimer);
			return { status: "ok", response, buffer };
		} catch (error) {
			clearTimeout(budgetTimer);
			const suffix = redirectSuffix({ requestedUrl: params.url, responseUrl: lastRedirectHop });
			logError(`[CrawlArticle] Network error for ${params.url}${suffix}`, error instanceof Error ? error : undefined);
			return {
				status: "failed",
				finalUrl: lastRedirectHop,
				failure: classifyFetchError(error),
			};
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
	documentUrl: string;
	fetchThumbnail?: boolean;
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
}): Promise<CrawlArticleResult> {
	const { buffer, bodyHash, response, documentUrl, fetchThumbnail, crawlFetch, logError, logInfo } = input;
	const html = new TextDecoder().decode(buffer);
	const candidates = extractThumbnailCandidates({ html, baseUrl: documentUrl });
	const thumbnailUrl = candidates[0];
	const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError, logInfo });
	const thumbnail = fetchThumbnail
		? await fetchThumbnailImage({ candidates, referer: documentUrl })
		: undefined;
	const result: CrawlArticleResult & { status: "fetched" } = {
		status: "fetched",
		html,
		etag: headerOrUndefined(response.headers, "etag"),
		lastModified: headerOrUndefined(response.headers, "last-modified"),
		bodyHash,
	};
	if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
	if (thumbnail) result.thumbnail = thumbnail;
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
	const suffix = redirectSuffix({ requestedUrl: input.url, responseUrl: input.response?.url });
	if (input.buffer.length > input.maxPdfBytes) {
		input.logError(`[CrawlArticle] PDF body too large (${input.buffer.length} bytes) for ${input.url}${suffix}`);
		return { status: "unsupported", reason: `pdf body too large: ${input.buffer.length} bytes` };
	}
	const extracted = await input.extractPdf({
		buffer: input.buffer,
		url: input.url,
		onProgress: input.onProgress,
	});
	if (extracted.kind === "failed") {
		input.logError(`[CrawlArticle] PDF extraction failed for ${input.url}${suffix}: ${extracted.reason}`);
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
 *   - X/Twitter URLs bypass the article fetch entirely (oembed has the text);
 *     an apple.news URL restarts the crawl at the story URL its shell opens.
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
	/** Omitted, an unproxied crawler's budget applies. A composition root that
	 * configures an egress proxy passes PROXIED_FETCH_TIMEOUTS, whose header
	 * budget seats the proxied second pass; tests inject millisecond-scale
	 * budgets so the timer-abort paths run for real. */
	fetchTimeouts?: FetchTimeouts;
}): CrawlArticle {
	const { crawlFetch, siteRules, extractPdf, logError, logInfo } = deps;
	const fetchTimeouts = deps.fetchTimeouts ?? DEFAULT_FETCH_TIMEOUTS;
	const conditionalGet = initConditionalGet({ crawlFetch, logError, logInfo, fetchTimeouts });
	return async (params) => {
		let currentUrl = params.url;
		let redirectingSite: SiteRules | undefined;
		for (let siteRedirects = 0; ; siteRedirects++) {
			if (siteRedirects > MAX_SITE_RULE_REDIRECTS) {
				logError(
					`[CrawlArticle] Too many site-rule redirects (>${MAX_SITE_RULE_REDIRECTS}) for ${params.url}`,
				);
				return { status: "failed" };
			}
			let hostname: string;
			try {
				hostname = new URL(currentUrl).hostname;
			} catch {
				logError(`[CrawlArticle] Invalid URL ${currentUrl}`);
				return { status: "failed" };
			}
			/* Site-specific crawl override: the first matching site whose `onCrawl`
			 * returns content (e.g. X/Twitter oembed), redirects the crawl (e.g. the
			 * apple.news shell), or fails closed wins; `skip` falls through to the
			 * normal fetch cascade below. */
			let siteRedirect: string | undefined;
			let claimingSite: SiteRules | undefined;
			for (const site of siteRules) {
				let claimed: boolean;
				try {
					claimed = site.matches({ url: currentUrl, hostname });
				} catch (error) {
					logError(
						`[CrawlArticle] Site matches threw for ${currentUrl}`,
						error instanceof Error ? error : undefined,
					);
					continue;
				}
				if (!claimed) continue;
				claimingSite = site;
				let outcome: SiteCrawlOutcome;
				try {
					outcome = await site.onCrawl({ url: currentUrl });
				} catch (error) {
					logError(
						`[CrawlArticle] Site onCrawl threw for ${currentUrl}`,
						error instanceof Error ? error : undefined,
					);
					return { status: "failed" };
				}
				if (outcome.kind === "skip") continue;
				if (outcome.kind === "failed") return { status: "failed" };
				if (outcome.kind === "redirect") {
					siteRedirect = outcome.url;
					break;
				}
				return {
					status: "fetched",
					html: outcome.html,
					bodyHash: createHash("sha256").update(outcome.html).digest("hex"),
				};
			}
			if (siteRedirect === undefined) break;
			redirectingSite = claimingSite;
			currentUrl = siteRedirect;
		}
		const fetched = await conditionalGet({ ...params, url: currentUrl });
		if (fetched.status !== "ok") return recoverRefusedTerminal({ fetched, site: redirectingSite, url: params.url, logInfo });
		/* c8 ignore next -- V8 block-coverage phantom: the early-return continuation directly after the site-rule redirect loop gets a spurious zero-count sub-range even though the ok and non-ok statuses both have tests; restructuring only relocates it. See bcoe/c8#319 and https://v8.dev/blog/javascript-code-coverage */
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
			const suffix = redirectSuffix({ requestedUrl: currentUrl, responseUrl: terminalUrl(response) });
			logError(`[CrawlArticle] Unsupported content-type "${contentType}" for ${currentUrl}${suffix}`);
			return { status: "unsupported", reason: `unsupported content type: ${contentType}` };
		}
		if (buffer.byteLength > HTML_PARSE_BYTE_CAP[mediaType]) {
			const suffix = redirectSuffix({ requestedUrl: currentUrl, responseUrl: terminalUrl(response) });
			logError(
				`[CrawlArticle] Body too large (${buffer.byteLength} bytes, cap ${MAX_HTML_BYTES.label}) for ${currentUrl}${suffix}`,
			);
			return {
				status: "unsupported",
				reason: `content body too large: ${buffer.byteLength} bytes (cap ${MAX_HTML_BYTES.bytes} bytes)`,
				unsupportedReason: { kind: "content-too-large", bytes: buffer.byteLength },
			};
		}
		const result = await dispatchSupportedMedia({
			mediaType,
			buffer,
			bodyHash,
			response,
			contentType,
			url: currentUrl,
			documentUrl: resolveDocumentUrl({ requestedUrl: currentUrl, finalUrl: terminalUrl(response) }),
			fetchThumbnail: params.fetchThumbnail,
			onProgress: params.onProgress,
			extractPdf,
			crawlFetch,
			logError,
			logInfo,
		});
		/* One dispatch point rather than one per parser, so a 3xx resolves the
		 * article's identity uniformly across HTML/PDF/text/image. */
		if (result.status === "fetched") result.finalUrl = terminalUrl(response);
		return result;
	};
}

/**
 * Content-type dispatch for a successfully fetched body. Kept as one exhaustive
 * switch so adding a `MEDIA_TYPE_MATCHERS` member fails to compile until handled
 * here; the caller stamps `finalUrl` onto the returned `fetched` result.
 */
async function dispatchSupportedMedia(input: {
	mediaType: SupportedMediaType;
	buffer: Buffer;
	bodyHash: string;
	response: Response;
	contentType: string;
	url: string;
	documentUrl: string;
	fetchThumbnail?: boolean;
	onProgress?: ComprehensiveCrawlProgress;
	extractPdf?: ExtractPdf;
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
}): Promise<CrawlArticleResult> {
	const { mediaType, buffer, bodyHash, response, contentType, url, documentUrl, crawlFetch, logError, logInfo } = input;
	switch (mediaType) {
		case "html":
			return parseHtmlFromBuffer({
				buffer,
				bodyHash,
				response,
				documentUrl,
				fetchThumbnail: input.fetchThumbnail,
				crawlFetch,
				logError,
				logInfo,
			});
		case "pdf":
			if (!input.extractPdf) {
				const suffix = redirectSuffix({ requestedUrl: url, responseUrl: terminalUrl(response) });
				logInfo(`[CrawlArticle] PDF deferred to comprehensive crawl (no extractPdf in this runtime) for ${url}${suffix}`);
				return { status: "unsupported", reason: `unsupported content type: ${contentType}` };
			}
			return parsePdfFromBuffer({
				buffer,
				bodyHash,
				response,
				url,
				maxPdfBytes: MAX_PDF_BYTES.bytes,
				extractPdf: input.extractPdf,
				onProgress: input.onProgress,
				logError,
			});
		case "plain-text":
			return parsePlainTextFromBuffer({ buffer, bodyHash, response, documentUrl });
		case "image":
			return parseImageFromBuffer({
				buffer,
				bodyHash,
				response,
				url,
				documentUrl,
				contentType,
				logError,
			});
	}
}
