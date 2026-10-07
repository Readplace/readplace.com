import {
	type CrawlArticle,
	type CrawlUnsupportedReason,
	type FetchFailureClassification,
	resolveDocumentUrl,
} from "@packages/crawl-article";
import { validateSaveableUrl } from "@packages/domain/article";
import type { MediaWriteContext } from "./put-image-object.types";
import { type FinalizeArticle, type FinalizedArticle, UNREADABLE_ARTICLE } from "./finalize-article";

export type CrawlAndFinalizeResult =
	| {
			status: "fetched";
			article: FinalizedArticle;
			/** The post-redirect terminal URL (`response.url`). Identity adoption
			 * keys on this. Absent when no HTTP fetch resolved a terminal
			 * (site-rule/oembed) or the fetch did not redirect. */
			finalUrl?: string;
			etag?: string;
			lastModified?: string;
			bodyHash: string;
			evaluationHtml?: string;
			httpStatus?: number;
			parseFailure?: string;
		}
	| { status: "not-modified" }
	| {
			status: "failed";
			reason: string;
			finalUrl?: string;
			failure?: FetchFailureClassification;
		}
	| { status: "blocked"; httpStatus: number; finalUrl?: string }
	| { status: "not-found"; httpStatus: 404 | 410; finalUrl?: string }
	| { status: "unsupported"; reason: string; unsupportedReason?: CrawlUnsupportedReason };

export type CrawlAndFinalizeArticle = (params: {
	writeContext?: MediaWriteContext;
	url: string;
	fetchUrl?: string;
	etag?: string;
	lastModified?: string;
	previousBodyHash?: string;
	retainResponseBody?: boolean;
	includeEvaluationHtml?: boolean;
}) => Promise<CrawlAndFinalizeResult>;

/**
 * The ONE entry point for every URL-based article path: initial save, recrawl,
 * stale-check, dev wrappers. Composes `crawlArticle` (always with
 * `fetchThumbnail: true`) with `finalizeArticle`, so no caller has to remember
 * to thread the thumbnail through — the upload happens for every fetch.
 *
 * Conditional etag/lastModified are forwarded to the crawler so stale-check
 * can still short-circuit on `not-modified`; other statuses (failed,
 * unsupported) are mapped through to the caller for handler-specific
 * post-processing (publish event, write tier source, etc.).
 */
export function initCrawlAndFinalizeArticle(deps: {
	crawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
}): CrawlAndFinalizeArticle {
	const { crawlArticle, finalizeArticle } = deps;
	return async (params) => {
		/** Defence-in-depth: validation runs at the web boundary, but the async
		 * workers re-fetch a stored URL, so re-check here and fail closed before
		 * any network call rather than trusting that intake validated it. */
		const fetchUrl = params.fetchUrl ?? params.url;
		if (validateSaveableUrl(fetchUrl).status === "ERROR") {
			return { status: "failed", reason: "unsafe-url" };
		}

		const crawlResult = await crawlArticle({
			url: fetchUrl,
			etag: params.etag,
			lastModified: params.lastModified,
			previousBodyHash: params.previousBodyHash,
			fetchThumbnail: true,
			retainResponseBody: params.retainResponseBody,
			...(params.fetchUrl !== undefined ? { skipFetchPin: true } : {}),
		});

		if (crawlResult.status === "not-modified") return { status: "not-modified" };
		if (crawlResult.status === "unsupported") {
			return {
				status: "unsupported",
				reason: crawlResult.reason,
				unsupportedReason: crawlResult.unsupportedReason,
			};
		}
		if (crawlResult.status === "not-found") {
			return { status: "not-found", httpStatus: crawlResult.httpStatus, finalUrl: crawlResult.finalUrl };
		}
		if (crawlResult.status === "blocked") {
			return { status: "blocked", httpStatus: crawlResult.httpStatus, finalUrl: crawlResult.finalUrl };
		}
		if (crawlResult.status === "failed") {
			return {
				status: "failed",
				reason: "crawl-failed",
				finalUrl: crawlResult.finalUrl,
				failure: crawlResult.failure,
			};
		}

		const finalized = await finalizeArticle({
			writeContext: params.writeContext,
			url: params.url,
			documentUrl: resolveDocumentUrl({ requestedUrl: fetchUrl, finalUrl: crawlResult.finalUrl }),
			html: crawlResult.html,
			resolvedThumbnail: crawlResult.thumbnail,
			mediaType: crawlResult.mediaType,
		});
		if (!finalized.ok) {
			const evaluationHtml = crawlResult.evaluationHtml ?? crawlResult.html;
			if (!params.retainResponseBody || evaluationHtml.trim() === "") return { status: "failed", reason: finalized.reason, finalUrl: crawlResult.finalUrl };
			return {
				status: "fetched",
				article: UNREADABLE_ARTICLE,
				evaluationHtml,
				bodyHash: crawlResult.bodyHash,
				finalUrl: crawlResult.finalUrl,
				httpStatus: crawlResult.httpStatus,
				parseFailure: finalized.reason,
			};
		}

		return {
			status: "fetched",
			article: finalized.article,
			finalUrl: crawlResult.finalUrl,
			etag: crawlResult.etag,
			lastModified: crawlResult.lastModified,
			bodyHash: crawlResult.bodyHash,
			...(params.retainResponseBody || params.includeEvaluationHtml ? { evaluationHtml: crawlResult.evaluationHtml ?? crawlResult.html, httpStatus: crawlResult.httpStatus } : {}),
		};
	};
}
