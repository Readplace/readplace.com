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
}

export function renderReaderSlot(input: ReaderSlotInput): string {
	// Valid terminal states first.
	if (input.crawl?.status === "failed") {
		return renderReaderFailed({
			url: input.url,
			extensionInstallUrl: input.extensionInstallUrl,
		});
	}
	// `crawl === undefined` is the legacy-row contract from
	// dynamodb-article-crawl.ts:rowToArticleCrawl: rows that pre-date the
	// state machines have no `crawlStatus` attribute, and the storage layer
	// pushes the decision to this dispatcher — render content if it's there,
	// otherwise the catch-all below treats it as pending.
	if (input.content && (input.crawl?.status === "ready" || input.crawl === undefined)) {
		return renderReaderReady({ content: input.content });
	}
	// Catch-all: render pending with a poll URL. Covers the normal in-flight
	// case (`crawl.status === "pending"`), the read-after-write race
	// (`crawl === undefined && !content`), and the inconsistent state where
	// the worker marked crawl ready but no content is readable. If no system
	// flips the underlying status, the slot stays "pending" forever — picked
	// up by .github/workflows/stuck-articles-canary.yml whenever the DB row
	// is `crawlStatus="pending"` or carries no state at all (legacy stub).
	return renderReaderPending({ pollUrl: input.readerPollUrl });
}
