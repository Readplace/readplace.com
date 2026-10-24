import assert from "node:assert";
import {
	type ArticleDestinationUrl,
	articleDestinationUrl,
	displayableReadTime,
	hostStubMetadata,
	isNonArticleHost,
	type ArticleBody,
	type StoredArticleBody,
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
import { type ReaderSlotCapture, renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import { renderTableOfContents } from "../article-body/table-of-contents/table-of-contents.component";
import { toAbsoluteDate, toAbsoluteTime, type LocalTime } from "@packages/web-shell/local-time.format";
import type {
	ArticleReaderDeps,
	ArticleVersion,
	CapturePollUrls,
	HandlePollParams,
	PollUrlBuilder,
	ReaderState,
	ReaderViewFailedOob,
	ResolveReaderStateParams,
} from "./article-reader.types";
import { isReaderContentUnavailable } from "../article-state/is-reader-content-unavailable";
import { isReaderViewFailed } from "../article-state/is-reader-view-failed";
import { MAX_POLLS } from "@packages/web-shell";
import {
	type CaptureResolution,
	type CaptureWatch,
	NO_CAPTURE_WATCH,
	resolveCaptureWatch,
} from "./capture-watch";

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
	articleId: string | undefined;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: ArticleBody | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrls: CapturePollUrls | undefined;
	capture: ReaderSlotCapture;
	summaryOpen: boolean;
	summaryToggleUrl: string | undefined;
	extensionInstallUrl: string | undefined;
	metadataOob: string;
	readerViewFailedOob: string;
	downloadsOob: string;
	appOrigin: string;
	readerNotice: ReaderFailedVariant | undefined;
	title: string | undefined;
}

function renderPollResponseBody(input: PollResponseBodyInput): string {
	const reader = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		articleId: input.articleId,
		readerPollUrl: input.readerPollUrl,
		capturePollUrls: input.capturePollUrls,
		capture: input.capture,
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
		title: input.title,
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

function capturePollUrlsFor(
	crawl: ArticleCrawl | undefined,
	pollUrlBuilder: PollUrlBuilder,
): CapturePollUrls | undefined {
	if (crawl?.status !== "failed") return undefined;
	const noticeRevision = crawl.outcomeRevision;
	return {
		manual: pollUrlBuilder.reader(1, { kind: "started", noticeRevision, trigger: "manual" }),
		automatic: pollUrlBuilder.reader(1, { kind: "started", noticeRevision, trigger: "automatic" }),
	};
}

function watchCarriedBy(resolution: CaptureResolution): CaptureWatch {
	if (resolution.kind === "carry") return resolution.watch;
	if (resolution.kind === "copying") {
		return { kind: "watching", since: resolution.since, trigger: resolution.trigger };
	}
	return NO_CAPTURE_WATCH;
}

function slotCaptureFor(params: {
	resolution: CaptureResolution;
	readerPollUrl: string | undefined;
	gaveUpUrl: (watch: CaptureWatch) => string;
}): ReaderSlotCapture {
	const { resolution } = params;
	if (resolution.kind === "missing") return { kind: "missing" };
	if (resolution.kind !== "copying") return { kind: "none" };
	assert(params.readerPollUrl, "a copying capture is inside the poll budget, so the reader keeps polling");
	return {
		kind: "copying",
		pollUrl: params.readerPollUrl,
		gaveUpUrl: params.gaveUpUrl({ kind: "device-gave-up", since: resolution.since, trigger: resolution.trigger }),
	};
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
	capture: CaptureWatch;
}): {
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrls: CapturePollUrls | undefined;
	capture: ReaderSlotCapture;
} {
	const resolution = resolveCaptureWatch({ watch: args.capture, crawl: args.crawl, pollCount: args.pollCount });
	const readerStillRunning =
		(resolution.kind === "copying" || shouldKeepPollingReader(args.crawl, args.content)) &&
		args.pollCount < MAX_POLLS;
	const crawlTerminalFailure =
		args.crawl?.status === "failed" || args.crawl?.status === "unsupported";
	const summaryStillRunning =
		!crawlTerminalFailure &&
		(args.summary?.status ?? "pending") === "pending" &&
		args.pollCount < MAX_POLLS;
	const readerPollUrl = readerStillRunning
		? args.pollUrlBuilder.reader(args.pollCount + 1, watchCarriedBy(resolution))
		: undefined;
	return {
		readerPollUrl,
		summaryPollUrl: summaryStillRunning
			? args.pollUrlBuilder.summary(args.pollCount + 1)
			: undefined,
		capturePollUrls: capturePollUrlsFor(args.crawl, args.pollUrlBuilder),
		capture: slotCaptureFor({
			resolution,
			readerPollUrl,
			gaveUpUrl: (watch) => args.pollUrlBuilder.reader(args.pollCount + 1, watch),
		}),
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

function bodyOf(stored: StoredArticleBody): ArticleBody | undefined {
	return stored.kind === "article" ? stored.body : undefined;
}

/**
 * 1. Pending: the normal in-flight case.
 * 2. Read-after-write race: markCrawlPending hasn't propagated yet.
 * 3. Promotion race: save-link-work flipped crawlStatus="ready" but
 *    select-most-complete-content-handler hasn't copied the canonical S3
 *    object yet. MAX_POLLS
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
 * The stored log is intentionally unbounded (see `appendCrawlVersion`), so raising this
 * limit — or building a dedicated all-versions view — needs no backfill.
 */
export const MAX_ARTICLE_HISTORY_VERSIONS = 10;

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
	capturePollUrls: undefined,
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
		const { article, pollUrlBuilder } = params;
		if (isNonArticleHost(article.url)) return GATED_READER_STATE;
		const crawl = await deps.findArticleCrawlStatus(article.url);
		const summary = await deps.findGeneratedSummary(article.url);
		const freshness = await deps.findArticleFreshness(article.url);
		const versions = await deps.findArticleCrawlVersions(article.url);

		const content = bodyOf(await deps.readArticleContent(article.url));
		const summaryStatus = summary?.status ?? "pending";
		const summaryPollUrl = summaryStatus === "pending"
			? pollUrlBuilder.summary(1)
			: undefined;
		const readerPollUrl = shouldKeepPollingReader(crawl, content)
			? pollUrlBuilder.reader(1, NO_CAPTURE_WATCH)
			: undefined;

		return {
			content,
			crawl,
			summary,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrls: capturePollUrlsFor(crawl, pollUrlBuilder),
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
				articleId: undefined,
				crawl: undefined,
				summary: undefined,
				content: undefined,
				readerPollUrl: undefined,
				summaryPollUrl: undefined,
				capturePollUrls: undefined,
				capture: { kind: "none" },
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
				title: undefined,
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
			deps.readArticleContent(articleUrl).then(bodyOf),
			deps.findArticleByUrl(articleUrl),
		]);
		const destinationUrl = article?.destinationUrl ?? articleDestinationUrl({ url: articleUrl, displayUrl: undefined });
		const { readerPollUrl, summaryPollUrl, capturePollUrls, capture } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capture: params.capture,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "summary",
			url: destinationUrl,
			articleId: params.articleId,
			crawl,
			summary,
			content,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrls,
			capture,
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
			title: article?.metadata.title,
		}));
	}

	async function handleReaderPoll(params: HandlePollParams): Promise<Component> {
		const { articleUrl, pollCount, pollUrlBuilder, extensionInstallUrl } = params;
		if (isNonArticleHost(articleUrl)) return gatedPollResponse("reader", articleUrl);
		const [crawl, summary, content, article] = await Promise.all([
			deps.findArticleCrawlStatus(articleUrl),
			deps.findGeneratedSummary(articleUrl),
			deps.readArticleContent(articleUrl).then(bodyOf),
			deps.findArticleByUrl(articleUrl),
		]);
		const destinationUrl = article?.destinationUrl ?? articleDestinationUrl({ url: articleUrl, displayUrl: undefined });
		const { readerPollUrl, summaryPollUrl, capturePollUrls, capture } = computePollUrls({
			crawl, summary, content, pollCount, pollUrlBuilder, capture: params.capture,
		});
		return HtmlPage(renderPollResponseBody({
			primary: "reader",
			url: destinationUrl,
			articleId: params.articleId,
			crawl,
			summary,
			content,
			readerPollUrl,
			summaryPollUrl,
			capturePollUrls,
			capture,
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
			title: article?.metadata.title,
		}));
	}

	return { resolveReaderState, handleSummaryPoll, handleReaderPoll };
}
