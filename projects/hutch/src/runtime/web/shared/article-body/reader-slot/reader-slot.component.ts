import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { renderReaderFailed } from "./reader-failed.component";
import { renderReaderPending } from "./reader-pending.component";
import { renderReaderReady } from "./reader-ready.component";

export interface ReaderSlotInput {
	crawl?: ArticleCrawl;
	content?: string;
	url: string;
	readerPollUrl?: string;
	extensionInstallUrl?: string;
	/* When true, the rendered slot carries `hx-swap-oob="outerHTML"` so HTMX
	 * splices it into a sibling poll response and replaces the live slot. The
	 * stable `id="article-body-reader-slot"` on every variant gives HTMX a
	 * target across crawl state transitions. */
	oob?: boolean;
}

/**
 * Exhaustively dispatches over crawl.status. Adding a new CrawlStatus value
 * (or a new variant of ArticleCrawl) becomes a compile break here — the
 * switch covers every variant explicitly and TypeScript's exhaustiveness
 * check via the discriminated union prevents a forgotten case from compiling.
 *
 * The legacy `crawl === undefined` shape comes from
 * dynamodb-article-crawl.ts:rowToArticleCrawl: rows that pre-date the
 * state machines have no `crawlStatus` attribute. We render content if
 * present, otherwise treat it as pending.
 */
export function renderReaderSlot(input: ReaderSlotInput): string {
	const oob = input.oob === true;
	if (input.crawl === undefined) {
		return input.content
			? renderReaderReady({ content: input.content, oob })
			: renderReaderPending({ pollUrl: input.readerPollUrl, oob });
	}

	switch (input.crawl.status) {
		case "ready":
			/* Worker-bug catch-all: a ready row with no content is a writer
			 * inconsistency picked up by stuck-articles-canary; render pending
			 * so the slot retries instead of erroring. */
			return input.content
				? renderReaderReady({ content: input.content, oob })
				: renderReaderPending({ pollUrl: input.readerPollUrl, oob });
		case "pending":
			return renderReaderPending({ pollUrl: input.readerPollUrl, oob });
		case "failed":
			return renderReaderFailed({
				url: input.url,
				variant: "failed",
				extensionInstallUrl: input.extensionInstallUrl,
				oob,
			});
		case "unsupported":
			return renderReaderFailed({
				url: input.url,
				variant: "unsupported",
				extensionInstallUrl: input.extensionInstallUrl,
				oob,
			});
	}
}
