import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { isPDF } from "@packages/crawl-article";
import { renderReaderFailed } from "./reader-failed.component";
import { renderReaderPending } from "./reader-pending.component";
import { renderReaderReady } from "./reader-ready.component";
import { renderReaderStreaming } from "./reader-streaming.component";

export interface ReaderSlotInput {
	crawl?: ArticleCrawl;
	content?: string;
	url: string;
	readerPollUrl?: string;
	extensionInstallUrl?: string;
	/** Base URL for the SSE streaming Lambda's Function URL (e.g.
	 * `https://stream.readplace.com`). When set AND the row has partial
	 * content, the slot renders the streaming variant instead of the dots
	 * loader; the parent-side `reader-stream.client.ts` opens an EventSource
	 * against this base URL. Optional so unit tests and dev mode work
	 * without configuring the stream Lambda. */
	streamBaseUrl?: string;
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
 *
 * Pending without a poll URL (the worker is still going but the page has
 * exhausted its 40-tick budget) routes to the same `Your link is saved`
 * reframe as the failure variants — the user shouldn't sit watching a dead
 * spinner; the URL is recoverable on the source right now.
 */
/* Tells readers used to "feels-right" LLM output that this pipeline prefers
 * visible OCR artifacts over confidently-wrong rewrites. Uses the shared
 * `isPDF` helper from `@packages/crawl-article` — the same predicate the
 * backend uses with `contentType` + `bodyBytes` signals at fetch time. Here
 * we only have the URL pre-fetch, so we pass the `pathname` signal alone;
 * `isPDF` treats `pathname` as the weakest signal and a false negative just
 * shows the standard pending message. When the article aggregate gains a
 * persisted `mediaType` field (follow-up), the hint will read that instead
 * so it stays consistent with the parser branch even for PDF URLs without
 * a `.pdf` suffix and for future uploaded-PDF flows that have no URL. */
const PDF_LOADING_HINT =
	"We optimise for accuracy over slop — low-quality PDFs may produce some gibberish.";

function resolveLoadingHint(url: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return undefined;
	}
	if (isPDF({ pathname })) return PDF_LOADING_HINT;
	return undefined;
}

function pollOrSlow(input: ReaderSlotInput, oob: boolean): string {
	return input.readerPollUrl
		? renderReaderPending({
				pollUrl: input.readerPollUrl,
				oob,
				loadingHint: resolveLoadingHint(input.url),
			})
		: renderReaderFailed({
				url: input.url,
				variant: "slow",
				extensionInstallUrl: input.extensionInstallUrl,
				oob,
			});
}

/* Streaming sub-branch of the pending state: a partial-content snapshot is
 * available, the poll URL is still armed, and the page is configured with
 * a stream base URL. Returns undefined to signal "fall through to the
 * standard pending dispatcher" when any precondition is missing — keeps the
 * exhaustive switch's other branches uncluttered. */
function maybeStreaming(
	input: ReaderSlotInput,
	oob: boolean,
	partial: { content: string; version: number },
): string | undefined {
	if (!input.readerPollUrl) return undefined;
	if (!input.streamBaseUrl) return undefined;
	if (partial.content.length === 0) return undefined;
	return renderReaderStreaming({
		initialPartialHtml: partial.content,
		articleUrl: input.url,
		streamBaseUrl: input.streamBaseUrl,
		pollUrl: input.readerPollUrl,
		loadingHint: resolveLoadingHint(input.url),
		oob,
	});
}

export function renderReaderSlot(input: ReaderSlotInput): string {
	const oob = input.oob === true;
	if (input.crawl === undefined) {
		if (input.content) return renderReaderReady({ content: input.content, oob });
		return pollOrSlow(input, oob);
	}

	switch (input.crawl.status) {
		case "ready":
			/* Worker-bug catch-all: a ready row with no content is a writer
			 * inconsistency picked up by stuck-articles-canary; render pending
			 * so the slot retries instead of erroring. */
			if (input.content) return renderReaderReady({ content: input.content, oob });
			return pollOrSlow(input, oob);
		case "pending":
			if (input.crawl.partial) {
				const streaming = maybeStreaming(input, oob, input.crawl.partial);
				if (streaming) return streaming;
			}
			return pollOrSlow(input, oob);
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
