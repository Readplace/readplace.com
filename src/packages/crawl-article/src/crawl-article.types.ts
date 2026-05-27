import type { PdfExtractStage, PdfPartialHtml } from "./pdf-extract.types";

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
 * `onPartialHtml` is forwarded so the PDF extractor's Stage 0 (Tesseract)
 * can stream the in-order ready-prefix HTML to the orchestrator, which
 * routes it to the streaming reader UI.
 */
export type CrawlArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	fetchThumbnail?: boolean;
	onProgress?: ComprehensiveCrawlProgress;
	onPartialHtml?: PdfPartialHtml;
}) => Promise<CrawlArticleResult>;
