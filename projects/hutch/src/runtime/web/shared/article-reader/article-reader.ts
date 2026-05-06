import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { Component } from "../../component.types";
import { HtmlPage } from "../../html-page";
import { renderProgressBarOob } from "../article-body/progress-bar.component";
import {
	CRAWL_STAGE_TO_PCT,
	type CrawlStage,
	DEFAULT_CRAWL_STAGE,
	DEFAULT_SUMMARY_STAGE,
	type ProgressTick,
	SUMMARY_STAGE_TO_PCT,
	type SummaryStage,
} from "@packages/domain/article";
import { renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import type {
	ArticleReaderDeps,
	HandlePollParams,
	ReaderState,
	ResolveReaderStateParams,
} from "./article-reader.types";

const MAX_POLLS = 40;

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
): boolean {
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
 * terminal, or the crawl has failed and the summary slot has collapsed
 * (rendering a half-full bar there would just stall forever).
 */
function buildUnifiedProgress(
	crawl: ArticleCrawl | undefined,
	summary: GeneratedSummary | undefined,
	now: Date,
): ProgressTick | undefined {
	if (crawl?.status === "failed") return undefined;

	if (crawl?.status === "pending") {
		const stage: CrawlStage = crawl.stage ?? DEFAULT_CRAWL_STAGE;
		return {
			stage,
			pct: CRAWL_STAGE_TO_PCT[stage],
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

export function initArticleReader(deps: ArticleReaderDeps): {
	resolveReaderState: (params: ResolveReaderStateParams) => Promise<ReaderState>;
	handleSummaryPoll: (params: HandlePollParams) => Promise<Component>;
	handleReaderPoll: (params: HandlePollParams) => Promise<Component>;
} {
	async function resolveReaderState(
		params: ResolveReaderStateParams,
	): Promise<ReaderState> {
		const { article, pollUrlBuilder } = params;
		let crawl = await deps.findArticleCrawlStatus(article.url);
		let summary = await deps.findGeneratedSummary(article.url);

		// Legacy-stub healing: a row that exists but carries neither a crawl nor a
		// summary state attribute pre-dates the state machines. Re-prime both so it
		// reaches a terminal state instead of sitting on "Generating summary…"
		// forever on every render. Re-read so the same request picks up any state
		// the synchronous in-memory worker wrote during priming (real workers are
		// async; the re-read just surfaces whatever is durable now).
		if (crawl === undefined && summary === undefined) {
			await deps.markCrawlPending({ url: article.url });
			await deps.markSummaryPending({ url: article.url });
			crawl = await deps.findArticleCrawlStatus(article.url);
			summary = await deps.findGeneratedSummary(article.url);
		}

		const content = await deps.readArticleContent(article.url);
		const summaryStatus = summary?.status ?? "pending";
		const summaryPollUrl = summaryStatus === "pending"
			? pollUrlBuilder.summary(1)
			: undefined;
		const readerPollUrl = shouldKeepPollingReader(crawl, content)
			? pollUrlBuilder.reader(1)
			: undefined;

		return {
			content,
			crawl,
			summary,
			readerPollUrl,
			summaryPollUrl,
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
		};
	}

	async function handleSummaryPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder } = params;
		const crawl = await deps.findArticleCrawlStatus(articleUrl);
		const summary = await deps.findGeneratedSummary(articleUrl);
		const crawlFailed = crawl?.status === "failed";
		const status = summary?.status ?? "pending";
		const summaryPollUrl = !crawlFailed && status === "pending" && pollCount < MAX_POLLS
			? pollUrlBuilder.summary(pollCount + 1)
			: undefined;
		const slot = renderSummarySlot({
			crawl,
			summary,
			summaryPollUrl,
			summaryOpen: true,
		});
		const oobBar = renderProgressBarOob({
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
		});
		return HtmlPage(slot + oobBar);
	}

	async function handleReaderPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		const crawl = await deps.findArticleCrawlStatus(articleUrl);
		const summary = await deps.findGeneratedSummary(articleUrl);
		const content = await deps.readArticleContent(articleUrl);
		const readerPollUrl = shouldKeepPollingReader(crawl, content) && pollCount < MAX_POLLS
			? pollUrlBuilder.reader(pollCount + 1)
			: undefined;
		const slot = renderReaderSlot({
			crawl,
			content,
			url: articleUrl,
			readerPollUrl,
			extensionInstallUrl,
		});
		const oobBar = renderProgressBarOob({
			progress: buildUnifiedProgress(crawl, summary, deps.now()),
		});
		return HtmlPage(slot + oobBar);
	}

	return { resolveReaderState, handleSummaryPoll, handleReaderPoll };
}
