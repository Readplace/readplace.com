import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";

/**
 * Polls `/queue/:id/card` stop ticking once both pipelines reach a terminal
 * state. Mirrors `shouldKeepPollingReader` in article-reader.ts but for the
 * queue-list card surface, where the only visible fields that change are
 * title / siteName / excerpt / imageUrl / wordCount — i.e. the side effects of
 * crawl and summary completion.
 *
 * 1. Failed crawl wins immediately: the pipeline gave up so nothing else will
 *    arrive. The card stays on its hostname-derived stub.
 * 2. Pending crawl: title / imageUrl / wordCount may still land.
 * 3. Crawl ready, summary pending: excerpt may still mature.
 * 4. crawl === undefined && summary === undefined: legacy stub before either
 *    state machine has a row. Same heal as article-reader.ts:38-40 — keep
 *    polling, the next save-link-work tick will mark them pending.
 */
export function isCardTerminal(
	crawl: ArticleCrawl | undefined,
	summary: GeneratedSummary | undefined,
): boolean {
	if (crawl?.status === "failed") return true; /* 1 */
	if (crawl?.status === "pending") return false; /* 2 */
	const summaryStatus = summary?.status;
	if (crawl?.status === "ready" && summaryStatus === "pending") return false; /* 3 */
	if (crawl === undefined && summary === undefined) return false; /* 4 */
	if (crawl?.status === "ready" && summaryStatus === undefined) return false;
	return true;
}
