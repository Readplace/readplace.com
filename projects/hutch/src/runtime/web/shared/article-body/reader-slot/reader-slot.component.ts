import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ArticleDestinationUrl,
	DEFAULT_CRAWL_STAGE,
	crawlProgressPct,
	crawlStagePct,
	type ArticleBody,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { isPDF } from "@packages/crawl-article";
import { render } from "@packages/web-shell";
import { type FailedCrawlNotice, failedCrawlNotice } from "./failed-crawl-notice";
import {
	type ReaderFailedVariant,
	type ReaderRegions,
	renderReaderFailed,
} from "./reader-failed.component";
import { READER_PENDING_DESCRIPTION, renderReaderPending } from "./reader-pending.component";
import { renderReaderReady } from "./reader-ready.component";

export interface ReaderSlotInput {
	crawl?: ArticleCrawl;
	content?: ArticleBody;
	url: ArticleDestinationUrl;
	articleId: string | undefined;
	readerPollUrl?: string;
	extensionInstallUrl?: string;
	appOrigin: string;
	capturePollUrl?: string;
	capturing?: boolean;
	notice?: ReaderFailedVariant;
	/* When true, the rendered slot carries `hx-swap-oob="outerHTML"` so HTMX
	 * splices it into a sibling poll response and replaces the live slot. The
	 * stable `id="article-body-reader-slot"` on every variant gives HTMX a
	 * target across crawl state transitions. */
	oob?: boolean;
	noticeOob: boolean;
}

const EMPTY_NOTICE_TEMPLATE = readFileSync(
	join(__dirname, "reader-notice-empty.template.html"),
	"utf-8",
);

function withEmptyNotice(slot: string, noticeOob: boolean): ReaderRegions {
	return { slot, notice: render(EMPTY_NOTICE_TEMPLATE, { noticeOob }) };
}

/**
 * Exhaustively dispatches over crawl.status. Adding a new CrawlStatus value
 * (or a new variant of ArticleCrawl) becomes a compile break here — the
 * switch covers every variant explicitly and TypeScript's exhaustiveness
 * check via the discriminated union prevents a forgotten case from compiling.
 *
 * The `crawl === undefined` shape comes from persisted rows that pre-date
 * the state machines and have no `crawlStatus` attribute. We render content
 * if present, otherwise treat it as pending.
 *
 * Pending without a poll URL (the worker is still going but the page has
 * exhausted its budget) routes to the same `Your link is saved`
 * reframe as the failure variants — the URL is recoverable on the source.
 */
/* The message tells readers this pipeline prefers visible OCR artifacts over
 * confidently-wrong rewrites. Pre-fetch we only have the URL, so we pass the
 * pathname signal alone; a false negative just shows the standard pending
 * message. */
const PDF_LOADING_HINT =
	"Readplace optimises for accuracy over slop — low-quality PDFs may produce some optical scan gibberish.";

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

function noticeOrCapture(
	input: ReaderSlotInput,
	notice: FailedCrawlNotice,
	oob: boolean,
): ReaderRegions {
	if (input.capturing === true && input.readerPollUrl !== undefined) {
		return withEmptyNotice(
			renderReaderPending({
				kind: "capture",
				pollUrl: input.readerPollUrl,
				oob,
			}),
			input.noticeOob,
		);
	}
	return renderReaderFailed({
		url: input.url,
		articleId: input.articleId,
		variant: notice.variant,
		extensionInstallUrl: input.extensionInstallUrl,
		capturePollUrl: input.capturePollUrl,
		captureRescue: notice.captureRescue,
		oob,
		noticeOob: input.noticeOob,
	});
}

function pendingDescriptions(url: string): readonly string[] {
	const hint = resolveLoadingHint(url);
	return hint === undefined ? [READER_PENDING_DESCRIPTION] : [READER_PENDING_DESCRIPTION, hint];
}

function pollOrSlow(input: ReaderSlotInput, oob: boolean, pct: number): ReaderRegions {
	return input.readerPollUrl
		? withEmptyNotice(
				renderReaderPending({
					kind: "crawl",
					pollUrl: input.readerPollUrl,
					pct,
					descriptions: pendingDescriptions(input.url),
					oob,
				}),
				input.noticeOob,
			)
		: renderReaderFailed({
				url: input.url,
				articleId: input.articleId,
				variant: "slow",
				extensionInstallUrl: input.extensionInstallUrl,
				captureRescue: "withheld",
				oob,
				noticeOob: input.noticeOob,
			});
}

function ready(input: ReaderSlotInput, content: ArticleBody, oob: boolean): ReaderRegions {
	return withEmptyNotice(
		renderReaderReady({ content, oob, appOrigin: input.appOrigin }),
		input.noticeOob,
	);
}

export function renderReaderSlot(input: ReaderSlotInput): ReaderRegions {
	const oob = input.oob === true;
	if (input.notice !== undefined) {
		return renderReaderFailed({
			url: input.url,
			articleId: input.articleId,
			variant: input.notice,
			captureRescue: "withheld",
			oob,
			noticeOob: input.noticeOob,
		});
	}
	if (input.crawl === undefined) {
		if (input.content) return ready(input, input.content, oob);
		return pollOrSlow(input, oob, crawlStagePct(DEFAULT_CRAWL_STAGE));
	}

	switch (input.crawl.status) {
		case "ready":
			/* Worker-bug catch-all: a ready row with no content is a writer
			 * inconsistency picked up by stuck-articles-canary; render pending
			 * so the slot retries instead of erroring. */
			if (input.content) return ready(input, input.content, oob);
			return pollOrSlow(input, oob, crawlStagePct("crawl-content-uploaded"));
		case "pending":
			return pollOrSlow(
				input,
				oob,
				crawlProgressPct({
					stage: input.crawl.stage ?? DEFAULT_CRAWL_STAGE,
					parts: input.crawl.parts,
				}),
			);
		case "failed":
			return noticeOrCapture(input, failedCrawlNotice(input.crawl.reason), oob);
		case "unsupported":
			return noticeOrCapture(input, { variant: "unsupported", captureRescue: "withheld" }, oob);
	}
}
