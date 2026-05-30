import type { CrawlArticle, PdfPartialHtml } from "@packages/crawl-article";
import type { FinalizeArticle, FinalizedArticle } from "./finalize-article";
import { extractPreviewHtml } from "./extract-preview-html";

export type CrawlAndFinalizeResult =
	| {
			status: "fetched";
			article: FinalizedArticle;
			etag?: string;
			lastModified?: string;
		}
	| { status: "not-modified" }
	| { status: "failed"; reason: string }
	| { status: "unsupported"; reason: string };

export type CrawlAndFinalizeArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	/* Streaming hook. Fired once on a successful HTML crawl (preview HTML:
	 * title + first paragraphs extracted from the raw fetch) and (PDF only)
	 * by the extractor itself each time Tesseract's in-order ready prefix
	 * advances. The orchestrator routes each invocation to `markCrawlPartial`
	 * so the reader-slot's streaming variant can display content progressively
	 * before the canonical tier-source write lands. */
	onPartialHtml?: PdfPartialHtml;
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
			fetchThumbnail: true,
			onPartialHtml: params.onPartialHtml,
		});

		if (crawlResult.status === "not-modified") return { status: "not-modified" };
		if (crawlResult.status === "unsupported") {
			return { status: "unsupported", reason: crawlResult.reason };
		}
		if (crawlResult.status === "failed") {
			return { status: "failed", reason: "crawl-failed" };
		}

		/* HTML preview snapshot: title + first ~500 chars of body text,
		 * extracted from the raw fetched HTML before Readability runs.
		 * Lets the reader-slot show *something* within ~1 second of save
		 * for HTML articles, paralleling the PDF path's Tesseract stream. */
		if (params.onPartialHtml) {
			const preview = extractPreviewHtml(crawlResult.html);
			if (preview.length > 0) {
				params.onPartialHtml({ html: preview, readyPageCount: 1 });
			}
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
		};
	};
}
