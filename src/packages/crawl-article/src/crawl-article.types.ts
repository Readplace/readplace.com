export type ThumbnailImage = {
	body: Buffer;
	contentType: string;
	url: string;
	extension: string;
};

export type CrawlArticleResult =
	| {
			status: "fetched";
			html: string;
			thumbnailUrl?: string;
			thumbnailImage?: ThumbnailImage;
			etag?: string;
			lastModified?: string;
	  }
	| { status: "not-modified" }
	| { status: "failed" }
	| { status: "unsupported"; reason: string };

export type CrawlArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	fetchThumbnail?: boolean;
}) => Promise<CrawlArticleResult>;

/**
 * Same signature as `CrawlArticle`. The alias exists so call sites that need to
 * distinguish the two halves of the split can name the parameter — the simple
 * factory handles HTML + oembed, and bails with `unsupported` for any content
 * type it doesn't handle so the caller can decide whether to fall through to
 * the comprehensive factory.
 */
export type SimpleCrawl = CrawlArticle;

/**
 * Provider-shaped progress callback the orchestrator passes to a comprehensive
 * crawl. The provider decides what counts as a "part" — the PDF path counts
 * completed OCR chunks; future providers (audio transcription, video frame
 * extraction) count whatever discrete units of work they fan out into. The
 * callback is synchronous-fire-and-forget from the crawler's perspective and
 * any errors it surfaces are swallowed by the crawler.
 */
export type ComprehensiveCrawlProgress = (params: {
	partIndex: number;
	partCount: number;
}) => void;

/**
 * The comprehensive factory handles PDF extraction — the expensive path that
 * can hold a Lambda concurrency slot for tens of seconds while pdfjs walks
 * every page. Accepts an optional `onProgress` callback the orchestrator uses
 * to record per-part progress against the unified bar.
 */
export type ComprehensiveCrawl = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	onProgress?: ComprehensiveCrawlProgress;
}) => Promise<CrawlArticleResult>;

