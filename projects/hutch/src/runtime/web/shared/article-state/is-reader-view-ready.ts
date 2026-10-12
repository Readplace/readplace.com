import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";

// The reader view is ready exactly when renderReaderSlot renders its ready
// view: content present AND the crawl `ready` (or a legacy `crawl === undefined`
// row). Content presence alone is not enough — renderReaderSlot's `pending`
// branch ignores content, and content-present-with-crawl-pending is reachable
// (e.g. an admin recrawl flips the crawl back to `pending` without dropping the
// already-published content).
export function isReaderViewReady(input: {
	crawl: ArticleCrawl | undefined;
	content: string | undefined;
}): boolean {
	return !!input.content && (input.crawl === undefined || input.crawl.status === "ready");
}
