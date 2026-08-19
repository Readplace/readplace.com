import { parseHTML } from "linkedom";
import type { CrawlFetch } from "./crawl-fetch";
import { extensionFromContentType } from "./extension-from-content-type";
import type { ThumbnailCascade, ThumbnailImage } from "./crawl-article.types";
import { initLogFetchFailure, type LogFetchFailure } from "./log-fetch-failure";
import { BodyTooLargeError, readBodyWithCap } from "./read-capped-body";

const THUMBNAIL_FETCH_TIMEOUT_MS = 5000;
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

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
}) => Promise<ThumbnailCascade>;

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
	logInfo: (message: string) => void;
}): FetchThumbnailImage {
	const { crawlFetch, logError, logInfo } = deps;
	const logFetchFailure = initLogFetchFailure({ logError, logInfo });
	return async ({ candidates, referer }) => {
		const provenUnusable: string[] = [];
		let image: ThumbnailImage | undefined;
		for (const candidateUrl of candidates) {
			const outcome = await tryFetchImage({ crawlFetch, logError, logFetchFailure, url: candidateUrl, referer });
			if (outcome.verdict === "image") {
				image = outcome.image;
				break;
			}
			if (outcome.verdict === "proven-unusable") provenUnusable.push(candidateUrl);
		}
		return { image, provenUnusable };
	};
}

type CandidateOutcome =
	| { verdict: "image"; image: ThumbnailImage }
	| { verdict: "proven-unusable" }
	| { verdict: "unproven" };

const PROVEN_UNUSABLE: CandidateOutcome = { verdict: "proven-unusable" };
const UNPROVEN: CandidateOutcome = { verdict: "unproven" };
const RESOURCE_ABSENT_STATUSES: ReadonlySet<number> = new Set([404, 410]);

function outcomeForAbsentStatus(status: number): CandidateOutcome {
	if (RESOURCE_ABSENT_STATUSES.has(status)) return PROVEN_UNUSABLE;
	return UNPROVEN;
}

async function tryFetchImage(args: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
	logFetchFailure: LogFetchFailure;
	url: string;
	referer: string;
}): Promise<CandidateOutcome> {
	const { crawlFetch, logError, logFetchFailure, url, referer } = args;
	try {
		const response = await crawlFetch(url, {
			budgetMs: THUMBNAIL_FETCH_TIMEOUT_MS,
			headers: { accept: "image/*,*/*;q=0.8" },
			referer,
		});
		if (!response.ok) {
			/* c8 ignore next 4 -- V8 block-coverage phantom: the tail of this block's `return` gets a spurious zero-count sub-range that spills onto the closing brace even though the non-ok-response tests exercise it; the status branch itself stays enforced inside `outcomeForAbsentStatus`. See bcoe/c8#319 and https://v8.dev/blog/javascript-code-coverage */
			const message = `[CrawlArticle] Thumbnail HTTP ${response.status} for ${url}`;
			logFetchFailure({ status: response.status, message });
			return outcomeForAbsentStatus(response.status);
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.startsWith("image/")) {
			logError(`[CrawlArticle] Thumbnail unexpected Content-Type "${contentType}" for ${url}`);
			return PROVEN_UNUSABLE;
		}
		const contentLength = response.headers.get("content-length");
		if (contentLength && Number.parseInt(contentLength, 10) > MAX_THUMBNAIL_BYTES) {
			logError(`[CrawlArticle] Thumbnail too large (${contentLength} bytes) for ${url}`);
			return PROVEN_UNUSABLE;
		}
		const body = await readBodyWithCap(response, MAX_THUMBNAIL_BYTES);
		return {
			verdict: "image",
			image: { body, contentType, url, extension: extensionFromContentType({ contentType, url }) },
		};
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			logError(`[CrawlArticle] Thumbnail too large for ${url}`);
			return PROVEN_UNUSABLE;
		}
		logError(`[CrawlArticle] Thumbnail network error for ${url}`, error instanceof Error ? error : undefined);
		return UNPROVEN;
	}
}
