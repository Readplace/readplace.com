import type { PdfExtractStage } from "./pdf-extract.types";

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
			/* SHA-256 of the raw response body. Always populated on `fetched`.
			 * Callers persist this on the freshness row so a subsequent refresh
			 * can pass it back as `previousBodyHash` and short-circuit when the
			 * origin returns the same bytes under a 200 OK. */
			bodyHash: string;
	  }
	| { status: "not-modified" }
	| { status: "failed" }
	| { status: "unsupported"; reason: string };

/**
 * Provider-shaped progress callback the orchestrator passes through to a PDF
 * extraction. The provider decides what counts as a "part" — the PDF path
 * counts completed OCR chunks; future providers (audio transcription, video
 * frame extraction) count whatever discrete units of work they fan out into.
 * The callback is synchronous-fire-and-forget from the crawler's perspective
 * and any errors it surfaces are swallowed by the crawler.
 */
export type ComprehensiveCrawlProgress = (params: {
	partIndex: number;
	partCount: number;
	stage?: PdfExtractStage;
}) => void;

/**
 * The single crawl entry point. Issues one conditional GET, materialises the
 * body once, and dispatches to a content-type-specific parser. `fetchThumbnail`
 * opts the HTML path into prefetching the article thumbnail; `onProgress` is
 * forwarded to the PDF extractor (the expensive path that can hold a Lambda
 * concurrency slot for tens of seconds while pdfjs walks every page).
 */
export type CrawlArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	/* Hash of the body bytes from the previous successful fetch. When the
	 * conditional GET returns 200 OK (origin doesn't honour etag /
	 * last-modified), the crawler hashes the new body and compares: an exact
	 * match short-circuits to `not-modified` without invoking the parser
	 * (mupdf is the expensive path this gate protects). */
	previousBodyHash?: string;
	fetchThumbnail?: boolean;
	onProgress?: ComprehensiveCrawlProgress;
}) => Promise<CrawlArticleResult>;
