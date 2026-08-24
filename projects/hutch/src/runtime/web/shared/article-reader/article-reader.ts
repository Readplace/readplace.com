import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type {
	ArticleCrawlVersion,
	GlobalArticleData,
} from "@packages/provider-contracts/article-store";
import { HtmlPage } from "@packages/web-shell";
import type { Component } from "@packages/web-shell";

import {
	type ReaderQueueTags,
	renderArticleHeaderOob,
	renderDocumentTitleOob,
} from "../article-body/article-header/article-header.component";
import { renderProgressBarOob } from "../article-body/progress-bar.component";
import {
	CRAWL_STAGE_TO_PCT,
	type CrawlStage,
	DEFAULT_CRAWL_STAGE,
	DEFAULT_SUMMARY_STAGE,
	type ProgressTick,
	type SaveProvenance,
	SUMMARY_STAGE_TO_PCT,
	type SummaryStage,
} from "@packages/domain/article";
import { renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import { toAbsoluteShortDateTime, type LocalTime } from "@packages/web-shell/local-time.format";
import type {
	ArticleReaderDeps,
	HandlePollParams,
	PollUrlBuilder,
	ReaderState,
	ResolveReaderStateParams,
} from "./article-reader.types";
import { MAX_CAPTURE_POLLS, MAX_POLLS } from "@packages/web-shell";

/**
 * Required input for every poll response. Holds the *full* world state — both
 * crawl and summary axes, both poll URLs — alongside a discriminator naming
 * the axis whose slot is the primary swap target. By construction every
 * caller of `renderPollResponseBody` provides both axes, which means a poll
 * response can never silently drop one slot: the sibling is always emitted as
 * an `hx-swap-oob` swap so its HTMX polling chain re-arms if that axis just
 * flipped to pending while the primary axis was settling.
 *
 * This makes the cross-axis handoff a compile-time invariant rather than a
 * thing the two handlers have to remember.
 */
interface PollResponseBodyInput {
	primary: "reader" | "summary";
	url: string;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: string | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrl: string;
	capturing: boolean;
	summaryOpen: boolean;
	summaryToggleUrl: string | undefined;
	extensionInstallUrl: string | undefined;
	progress: ProgressTick | undefined;
	metadataOob: string;
	appOrigin: string;
}

function renderPollResponseBody(input: PollResponseBodyInput): string {
	const readerSlot = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		readerPollUrl: input.readerPollUrl,
		capturePollUrl: input.capturePollUrl,
		capturing: input.capturing,
		extensionInstallUrl: input.extensionInstallUrl,
		oob: input.primary !== "reader",
		appOrigin: input.appOrigin,
	});
	const summarySlot = renderSummarySlot({
		crawl: input.crawl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: input.summaryOpen,
		summaryToggleUrl: input.summaryToggleUrl,
		content: input.content,
		oob: input.primary !== "summary",
	});
	const progressBarOob = renderProgressBarOob({ progress: input.progress });
	if (input.primary === "reader") {
		return readerSlot + summarySlot + progressBarOob + input.metadataOob;
	}
	return summarySlot + readerSlot + progressBarOob + input.metadataOob;
}

/**
 * Single source of truth for "is this axis still in flight?" Computing both
 * URLs from the same state shape means a reader poll and a summary poll see
 * the same "should sibling be polling" decision, so the OOB sibling slot
 * always carries the same poll URL the sibling's own primary path would.
 */
function computePollUrls(args: {
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: string | undefined;
	pollCount: number;
	pollUrlBuilder: PollUrlBuilder;
	capturing: boolean;
}): {
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrl: string;
} {
	/* The device capture is a ~12s operation, so it gets its own much shorter
	 * budget than the server pipeline's. Past it the flag stops being re-armed
	 * and the row falls back to the ordinary rules — a capture that died on the
	 * device returns the user to the notice (and its retry) in a minute rather
	 * than showing "copying" for the pipeline's full 15. */
	const capturingStillArmed = args.capturing && args.pollCount < MAX_CAPTURE_POLLS;
	const readerStillRunning =
		shouldKeepPollingReader(args.crawl, args.content, capturingStillArmed) &&
		args.pollCount < MAX_POLLS;
	const crawlTerminalFailure =
		args.crawl?.status === "failed" || args.crawl?.status === "unsupported";
	const summaryStillRunning =
		!crawlTerminalFailure &&
		(args.summary?.status ?? "pending") === "pending" &&
		args.pollCount < MAX_POLLS;
	return {
		readerPollUrl: readerStillRunning
			? args.pollUrlBuilder.reader(args.pollCount + 1, capturingStillArmed)
			: undefined,
		summaryPollUrl: summaryStillRunning
			? args.pollUrlBuilder.summary(args.pollCount + 1)
			: undefined,
		capturePollUrl: args.pollUrlBuilder.reader(1, true),
	};
}

/**
 * 1. Pending: the normal in-flight case.
 * 2. Read-after-write race: markCrawlPending hasn't propagated yet.
 * 3. Promotion race: save-link-work flipped crawlStatus="ready" but
 *    select-most-complete-content-handler hasn't copied the canonical S3
 *    object yet, so readArticleContent still returns undefined. MAX_POLLS
 *    bounds the wait if the canonical write genuinely never lands.
 */
function shouldKeepPollingReader(
	crawl: ArticleCrawl | undefined,
	content: string | undefined,
	capturing: boolean,
): boolean {
	if (capturing) return true;
	if (crawl?.status === "pending") return true; /* 1 */
	if (crawl === undefined && content === undefined) return true; /* 2 */
	if (crawl?.status === "ready" && content === undefined) return true; /* 3 */
	return false;
}

/**
 * Single-bar progress: pick the further-along pipeline. While the crawl is
 * pending, drive the bar from the crawl stage on the lower half of the
 * unified scale. Once the crawl is ready (or undefined-with-content, the
 * legacy-row path) the summary takes over on the upper half.
 *
 * Returns undefined when there is nothing left to animate — both pipelines
 * terminal, or the crawl has failed/unsupported and the summary slot has
 * collapsed (rendering a half-full bar there would just stall forever).
 */
function buildUnifiedProgress(
	crawl: ArticleCrawl | undefined,
	summary: GeneratedSummary | undefined,
	now: Date,
): ProgressTick | undefined {
	if (crawl?.status === "failed" || crawl?.status === "unsupported") return undefined;

	if (crawl?.status === "pending") {
		const stage: CrawlStage = crawl.stage ?? DEFAULT_CRAWL_STAGE;
		const stagePct = CRAWL_STAGE_TO_PCT[stage];
		// Scale the bar inside the comprehensive-extracting / -cleaning band
		// when the OCR provider reports per-part progress. Without this, a
		// 300-page PDF would sit at the bottom of the band (23–26 %) for
		// minutes while the bar's client-side smoother drifts forward
		// without ground truth from the server.
		const isComprehensiveSubStage =
			stage === "comprehensive-extracting" || stage === "comprehensive-cleaning";
		const pct =
			isComprehensiveSubStage &&
			crawl.parts !== undefined &&
			crawl.parts.total > 0
				? stagePct +
					(crawl.parts.current / crawl.parts.total) *
						(CRAWL_STAGE_TO_PCT["crawl-parsed"] - stagePct)
				: stagePct;
		return {
			stage,
			pct,
			tickAt: now.toISOString(),
		};
	}

	const summaryStatus = summary?.status ?? "pending";
	if (summaryStatus !== "pending") return undefined;

	const recordedStage =
		summary?.status === "pending" ? summary.stage : undefined;
	const stage: SummaryStage = recordedStage ?? DEFAULT_SUMMARY_STAGE;
	return {
		stage,
		pct: SUMMARY_STAGE_TO_PCT[stage],
		tickAt: now.toISOString(),
	};
}

/**
 * The reader bookmark surfaces only the newest few dated versions. The stored
 * log is intentionally unbounded (see `appendCrawlVersion`), so raising this
 * limit — or building a dedicated all-versions view — needs no backfill.
 */
const MAX_BOOKMARK_CRAWL_VERSIONS = 10;

/**
 * Merge the crawl-version log with the legacy `contentFetchedAt` fallback into
 * the bookmark's newest-first tab list, capped at the newest
 * `MAX_BOOKMARK_CRAWL_VERSIONS` for display. Pre-feature articles have no
 * versions but do have a `contentFetchedAt`, so they still surface a single
 * current tab.
 */
function resolveCrawlVersions(
	versions: ArticleCrawlVersion[],
	contentFetchedAt: string | undefined,
): LocalTime[] {
	if (versions.length > 0) {
		return versions
			.slice(0, MAX_BOOKMARK_CRAWL_VERSIONS)
			.map((version) => toAbsoluteShortDateTime({ iso: version.crawledAtMinute }));
	}
	if (contentFetchedAt !== undefined) {
		return [toAbsoluteShortDateTime({ iso: contentFetchedAt })];
	}
	return [];
}

export function initArticleReader(deps: ArticleReaderDeps): {
	resolveReaderState: (params: ResolveReaderStateParams) => Promise<ReaderState>;
	handleSummaryPoll: (params: HandlePollParams) => Promise<Component>;
	handleReaderPoll: (params: HandlePollParams) => Promise<Component>;
} {
	async function resolveReaderState(
		params: ResolveReaderStateParams,
	): Promise<ReaderState> {
		const { article, pollUrlBuilder, capturing } = params;
		const crawl = await deps.findArticleCrawlStatus(article.url);
		const summary = await deps.findGeneratedSummary(article.url);
		const freshness = await deps.findArticleFreshness(article.url);
		const versions = await deps.findArticleCrawlVersions(article.url);

		const content = await deps.readArticleContent(article.url);
		const summaryStatus = summary?.status ?? "pending";
		const summaryPollUrl = summaryStatus === "pending"
			? pollUrlBuilder.summary(1)
			: undefined;
		const readerPollUrl = shouldKeepPollingReader(crawl, content, capturing)
			? pollUrlBuilder.reader(1, capturing)
			: undefined;

		return {
			content,
			crawl,
			summary,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrl: pollUrlBuilder.reader(1, true),
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
			crawlVersions: resolveCrawlVersions(versions, freshness?.contentFetchedAt),
		};
	}

	/**
	 * Header + <title> OOB fragments. Concatenated onto every poll response so
	 * the title that was rendered as a hostname stub at t=0 settles in place
	 * the moment the crawl writes the real metadata, instead of leaving the
	 * page stale until the user manually refreshes. Returns "" when the row
	 * has gone missing (deleted between renders); the slot fragment still
	 * swaps and the existing header/title stay put.
	 */
	function buildMetadataOob(
		article: GlobalArticleData | null,
		displayUrl: string,
		provenance: SaveProvenance | undefined,
		queueTags: ReaderQueueTags | undefined,
	): string {
		if (!article) return "";
		const headerOob = renderArticleHeaderOob({
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			estimatedReadTime: article.estimatedReadTime,
			url: displayUrl,
			provenance,
			queueTags,
		});
		const titleOob = renderDocumentTitleOob(
			deps.formatDocumentTitle(article.metadata.title),
		);
		return headerOob + titleOob;
	}

	async function handleSummaryPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		const [crawl, summary, content, article] = await Promise.all([
			deps.findArticleCrawlStatus(articleUrl),
			deps.findGeneratedSummary(articleUrl),
			deps.readArticleContent(articleUrl),
			deps.findArticleByUrl(articleUrl),
		]);
		const displayUrl = article?.displayUrl ?? articleUrl;
		const { readerPollUrl, summaryPollUrl, capturePollUrl } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capturing: params.capturing,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "summary",
			url: displayUrl,
			crawl,
			summary,
			content,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrl,
			capturing: params.capturing,
			summaryOpen: deps.summaryOpen,
			summaryToggleUrl: params.summaryToggleUrl,
			extensionInstallUrl,
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
			metadataOob: buildMetadataOob(article, displayUrl, params.provenance, params.queueTags),
			appOrigin: deps.appOrigin,
		}));
	}

	async function handleReaderPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		const [crawl, summary, content, article] = await Promise.all([
			deps.findArticleCrawlStatus(articleUrl),
			deps.findGeneratedSummary(articleUrl),
			deps.readArticleContent(articleUrl),
			deps.findArticleByUrl(articleUrl),
		]);
		const displayUrl = article?.displayUrl ?? articleUrl;
		const { readerPollUrl, summaryPollUrl, capturePollUrl } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capturing: params.capturing,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "reader",
			url: displayUrl,
			crawl,
			summary,
			content,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrl,
			capturing: params.capturing,
			summaryOpen: deps.summaryOpen,
			summaryToggleUrl: params.summaryToggleUrl,
			extensionInstallUrl,
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
			metadataOob: buildMetadataOob(article, displayUrl, params.provenance, params.queueTags),
			appOrigin: deps.appOrigin,
		}));
	}

	return { resolveReaderState, handleSummaryPoll, handleReaderPoll };
}
