import {
	type ArticleDestinationUrl,
	articleDestinationUrl,
	displayableReadTime,
	hostStubMetadata,
	isNonArticleHost,
} from "@packages/domain/article";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type {
	ArticleCrawlVersion,
	GlobalArticleData,
} from "@packages/provider-contracts/article-store";
import { HtmlPage } from "@packages/web-shell";
import type { Component } from "@packages/web-shell";

import {
	type ReaderReadlistTags,
	renderArticleHeaderOob,
	renderDocumentTitleOob,
} from "../article-body/article-header/article-header.component";
import type { ReaderProvenance } from "../article-body/article-header/provenance-label";
import { renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import { renderTableOfContents } from "../article-body/table-of-contents/table-of-contents.component";
import { toAbsoluteDate, toAbsoluteTime, type LocalTime } from "@packages/web-shell/local-time.format";
import type {
	ArticleReaderDeps,
	ArticleVersion,
	HandlePollParams,
	PollUrlBuilder,
	ReaderState,
	ReaderViewFailedOob,
	ResolveReaderStateParams,
} from "./article-reader.types";
import { isReaderContentUnavailable } from "../article-state/is-reader-content-unavailable";
import { isReaderViewFailed } from "../article-state/is-reader-view-failed";
import { MAX_CAPTURE_POLLS, MAX_POLLS } from "@packages/web-shell";

/**
 * Required input for every poll response. Holds the *full* world state — both
 * crawl and summary axes, both poll URLs — alongside a discriminator naming
 * the axis whose slot is the primary swap target. By construction every
 * caller of `renderPollResponseBody` provides both axes.
 *
 * This makes the cross-axis handoff a compile-time invariant rather than a
 * thing the two handlers have to remember.
 */
interface PollResponseBodyInput {
	primary: "reader" | "summary";
	url: ArticleDestinationUrl;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: string | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrl: string | undefined;
	capturing: boolean;
	summaryOpen: boolean;
	summaryToggleUrl: string | undefined;
	extensionInstallUrl: string | undefined;
	metadataOob: string;
	readerViewFailedOob: string;
	downloadsOob: string;
	appOrigin: string;
	readerNotice: ReaderFailedVariant | undefined;
}

function renderPollResponseBody(input: PollResponseBodyInput): string {
	const reader = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		readerPollUrl: input.readerPollUrl,
		capturePollUrl: input.capturePollUrl,
		capturing: input.capturing,
		extensionInstallUrl: input.extensionInstallUrl,
		notice: input.readerNotice,
		oob: input.primary !== "reader",
		noticeOob: true,
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
	const tableOfContents = renderTableOfContents({
		crawl: input.crawl,
		content: input.content,
		notice: input.readerNotice,
		appOrigin: input.appOrigin,
		oob: true,
	});
	if (input.primary === "reader") {
		return (
			reader.slot +
			summarySlot +
			tableOfContents +
			input.metadataOob +
			input.readerViewFailedOob +
			input.downloadsOob +
			reader.notice
		);
	}
	const readerSettledOnArticle =
		input.readerPollUrl === undefined && input.content !== undefined;
	return (
		summarySlot +
		(readerSettledOnArticle ? "" : reader.slot + tableOfContents) +
		input.metadataOob +
		input.readerViewFailedOob +
		input.downloadsOob +
		reader.notice
	);
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
 * Emits only when the reader view has failed AND both poll chains are settled.
 * Gating on settled, not merely failed, avoids replaying the banner/CTA every 3s
 * through the content-promotion race (crawl ready, content not yet copied,
 * summary failed) where the reader chain keeps polling.
 */
function settledFailureOob(input: {
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	render: ReaderViewFailedOob;
}): string {
	const settled =
		input.readerPollUrl === undefined && input.summaryPollUrl === undefined;
	return settled &&
		isReaderViewFailed({
			crawlStatus: input.crawl?.status,
			summaryStatus: input.summary?.status,
		})
		? input.render({ readerContentUnavailable: isReaderContentUnavailable({ crawlStatus: input.crawl?.status }) })
		: "";
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
 * The stored log is intentionally unbounded (see `appendCrawlVersion`), so raising this
 * limit — or building a dedicated all-versions view — needs no backfill.
 */
const MAX_ARTICLE_HISTORY_VERSIONS = 10;

function toArticleVersion(iso: string): ArticleVersion {
	return { minuteId: iso, date: toAbsoluteDate({ iso }), time: toAbsoluteTime({ iso }) };
}

/**
 * Merge the crawl-version log with the legacy `contentFetchedAt` fallback,
 * capped at the newest `MAX_ARTICLE_HISTORY_VERSIONS` for display. Pre-feature
 * articles have no versions but do have a `contentFetchedAt`.
 */
function resolveCrawlVersions(
	versions: ArticleCrawlVersion[],
	contentFetchedAt: string | undefined,
): ArticleVersion[] {
	if (versions.length > 0) {
		return versions
			.slice(0, MAX_ARTICLE_HISTORY_VERSIONS)
			.map((version) => toArticleVersion(version.crawledAtMinute));
	}
	if (contentFetchedAt !== undefined) {
		return [toArticleVersion(contentFetchedAt)];
	}
	return [];
}

const NOT_AN_ARTICLE: ReaderFailedVariant = "not-an-article";

const GATED_READER_STATE: ReaderState = {
	content: undefined,
	crawl: undefined,
	summary: undefined,
	readerPollUrl: undefined,
	summaryPollUrl: undefined,
	capturePollUrl: undefined,
	crawlVersions: [],
	readerViewFailed: false,
	readerContentUnavailable: true,
	notice: NOT_AN_ARTICLE,
};

export function initArticleReader(deps: ArticleReaderDeps): {
	resolveReaderState: (params: ResolveReaderStateParams) => Promise<ReaderState>;
	handleSummaryPoll: (params: HandlePollParams) => Promise<Component>;
	handleReaderPoll: (params: HandlePollParams) => Promise<Component>;
} {
	async function resolveReaderState(
		params: ResolveReaderStateParams,
	): Promise<ReaderState> {
		const { article, pollUrlBuilder, capturing } = params;
		if (isNonArticleHost(article.url)) return GATED_READER_STATE;
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
			crawlVersions: resolveCrawlVersions(versions, freshness?.contentFetchedAt),
			readerViewFailed: isReaderViewFailed({
				crawlStatus: crawl?.status,
				summaryStatus: summary?.status,
			}),
			readerContentUnavailable: isReaderContentUnavailable({ crawlStatus: crawl?.status }),
			notice: undefined,
		};
	}

	function gatedPollResponse(
		primary: "reader" | "summary",
		articleUrl: string,
	): Component {
		const destinationUrl = articleDestinationUrl({ url: articleUrl, displayUrl: undefined });
		const stub = hostStubMetadata(destinationUrl);
		return HtmlPage(
			renderPollResponseBody({
				primary,
				url: destinationUrl,
				crawl: undefined,
				summary: undefined,
				content: undefined,
				readerPollUrl: undefined,
				summaryPollUrl: undefined,
				capturePollUrl: undefined,
				capturing: false,
				summaryOpen: deps.summaryOpen,
				summaryToggleUrl: undefined,
				extensionInstallUrl: undefined,
				metadataOob:
					renderArticleHeaderOob({
						title: stub.title,
						siteName: stub.siteName,
						readTime: undefined,
						url: destinationUrl,
						provenance: undefined,
						readlistTags: undefined,
						saved: undefined,
					}) + renderDocumentTitleOob(deps.formatDocumentTitle(stub.title)),
				readerViewFailedOob: "",
				downloadsOob: "",
				appOrigin: deps.appOrigin,
				readerNotice: NOT_AN_ARTICLE,
			}),
		);
	}

	/**
	 * Header + <title> OOB fragments. Concatenated onto every poll response so
	 * the title that was rendered as a hostname stub at t=0 settles in place
	 * the moment the crawl writes the real metadata, instead of leaving the
	 * page stale until the user manually refreshes. Returns "" when the row
	 * has gone missing (deleted between renders); the slot fragment still
	 * swaps and the existing header/title stay put.
	 */
	function buildMetadataOob(input: {
		article: GlobalArticleData | null;
		destinationUrl: ArticleDestinationUrl;
		provenance: ReaderProvenance | undefined;
		readlistTags: ReaderReadlistTags | undefined;
		saved: LocalTime | undefined;
	}): string {
		const { article } = input;
		if (!article) return "";
		const headerOob = renderArticleHeaderOob({
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			readTime: displayableReadTime(article),
			url: input.destinationUrl,
			provenance: input.provenance,
			readlistTags: input.readlistTags,
			saved: input.saved,
		});
		const titleOob = renderDocumentTitleOob(
			deps.formatDocumentTitle(article.metadata.title),
		);
		return headerOob + titleOob;
	}

	async function handleSummaryPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		if (isNonArticleHost(articleUrl)) return gatedPollResponse("summary", articleUrl);
		const [crawl, summary, content, article] = await Promise.all([
			deps.findArticleCrawlStatus(articleUrl),
			deps.findGeneratedSummary(articleUrl),
			deps.readArticleContent(articleUrl),
			deps.findArticleByUrl(articleUrl),
		]);
		const destinationUrl = article?.destinationUrl ?? articleDestinationUrl({ url: articleUrl, displayUrl: undefined });
		const { readerPollUrl, summaryPollUrl, capturePollUrl } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capturing: params.capturing,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "summary",
			url: destinationUrl,
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
			metadataOob: buildMetadataOob({
				article,
				destinationUrl,
				provenance: params.provenance,
				readlistTags: params.readlistTags,
				saved: params.saved,
			}),
			downloadsOob: content === undefined || params.renderDownloadsOob === undefined ? "" : params.renderDownloadsOob(articleUrl),
			readerViewFailedOob: settledFailureOob({
				crawl,
				summary,
				readerPollUrl,
				summaryPollUrl,
				render: params.readerViewFailedOob,
			}),
			appOrigin: deps.appOrigin,
			readerNotice: undefined,
		}));
	}

	async function handleReaderPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		if (isNonArticleHost(articleUrl)) return gatedPollResponse("reader", articleUrl);
		const [crawl, summary, content, article] = await Promise.all([
			deps.findArticleCrawlStatus(articleUrl),
			deps.findGeneratedSummary(articleUrl),
			deps.readArticleContent(articleUrl),
			deps.findArticleByUrl(articleUrl),
		]);
		const destinationUrl = article?.destinationUrl ?? articleDestinationUrl({ url: articleUrl, displayUrl: undefined });
		const { readerPollUrl, summaryPollUrl, capturePollUrl } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capturing: params.capturing,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "reader",
			url: destinationUrl,
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
			metadataOob: buildMetadataOob({
				article,
				destinationUrl,
				provenance: params.provenance,
				readlistTags: params.readlistTags,
				saved: params.saved,
			}),
			downloadsOob: content === undefined || params.renderDownloadsOob === undefined ? "" : params.renderDownloadsOob(articleUrl),
			readerViewFailedOob: settledFailureOob({
				crawl,
				summary,
				readerPollUrl,
				summaryPollUrl,
				render: params.readerViewFailedOob,
			}),
			appOrigin: deps.appOrigin,
			readerNotice: undefined,
		}));
	}

	return { resolveReaderState, handleSummaryPoll, handleReaderPoll };
}
