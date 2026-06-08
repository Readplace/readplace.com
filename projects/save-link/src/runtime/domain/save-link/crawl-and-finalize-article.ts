import type { CrawlArticle } from "@packages/crawl-article";
import type { FinalizeArticle, FinalizedArticle } from "./finalize-article";

export type CrawlAndFinalizeResult =
	| {
			status: "fetched";
			article: FinalizedArticle;
			etag?: string;
			lastModified?: string;
			bodyHash: string;
		}
	| { status: "not-modified" }
	| { status: "failed"; reason: string }
	| { status: "unsupported"; reason: string };

export type CrawlAndFinalizeArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	previousBodyHash?: string;
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
		const crawlResult = await crawlArticle({
			url: params.url,
			etag: params.etag,
			lastModified: params.lastModified,
			previousBodyHash: params.previousBodyHash,
			fetchThumbnail: true,
		});

		if (crawlResult.status === "not-modified") return { status: "not-modified" };
		if (crawlResult.status === "unsupported") {
			return { status: "unsupported", reason: crawlResult.reason };
		}
		if (crawlResult.status === "failed") {
			return { status: "failed", reason: "crawl-failed" };
		}

		const finalized = await finalizeArticle({
			url: params.url,
			html: crawlResult.html,
			preFetchedThumbnail: crawlResult.thumbnailImage,
		});
		if (!finalized.ok) return { status: "failed", reason: finalized.reason };

		return {
			status: "fetched",
			article: finalized.article,
			etag: crawlResult.etag,
			lastModified: crawlResult.lastModified,
			bodyHash: crawlResult.bodyHash,
		};
	};
}
