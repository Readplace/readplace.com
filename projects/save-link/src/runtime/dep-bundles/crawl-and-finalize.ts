import { initFetchThumbnailImage } from "@packages/crawl-article";
import {
	initFinalizeArticle,
	type FinalizeArticle,
} from "../domain/save-link/finalize-article";
import {
	initCrawlAndFinalizeArticle,
	type CrawlAndFinalizeArticle,
} from "../domain/save-link/crawl-and-finalize-article";
import type { LogError } from "./observability";
import type { ArticleStoreDepBundle } from "./article-store";
import type { MediaDepBundle } from "./media";
import type { ParserDepBundle } from "./parser";

export type CrawlAndFinalizeDepBundle = {
	finalizeArticle: FinalizeArticle;
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
};

/* Wires the unified parse → media → thumbnail-upload pipeline. Every
 * caller that produces a tier source — SaveLink, RecrawlLinkInitiated,
 * SaveAnonymousLink, StaleCheckRequested, ComprehensiveCrawlCommand,
 * SaveLinkRawHtmlCommand, and the in-memory dev wrappers — composes its
 * Lambda by including this bundle, so the algorithm cannot drift between
 * triggers. */
export function initCrawlAndFinalizeDepBundle(deps: {
	parser: ParserDepBundle;
	media: MediaDepBundle;
	articleStore: ArticleStoreDepBundle;
	imagesCdnBaseUrl: string;
	logError: LogError;
}): CrawlAndFinalizeDepBundle {
	const fetchThumbnailImage = initFetchThumbnailImage({
		crawlFetch: deps.parser.crawlFetch,
		logError: deps.logError,
	});
	const finalizeArticle = initFinalizeArticle({
		parseHtml: deps.parser.parseHtml,
		downloadMedia: deps.media.downloadMedia,
		processContent: deps.media.processContent,
		fetchThumbnailImage,
		putImageObject: deps.articleStore.putImageObject,
		imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
	});
	const crawlAndFinalizeArticle = initCrawlAndFinalizeArticle({
		crawlArticle: deps.parser.crawlArticle,
		finalizeArticle,
	});
	return { finalizeArticle, crawlAndFinalizeArticle };
}
