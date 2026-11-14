import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { ABSENT_ENCLOSURE, ANONYMOUS_VIEWER, type EnclosureRead, ReaderArticleHashId, shownSummary, storedArticleBody, type Viewer, viewerFor } from "@packages/domain/article";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawlVersion } from "@packages/provider-contracts/article-store";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { GlobalArticleData } from "@packages/test-fixtures/providers/article-store";
import { MAX_CAPTURE_POLLS, MAX_POLLS } from "@packages/web-shell";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import type { RequestResolutionOnView } from "../../../domain/resolve-on-view/request-resolution-on-view";
import { initArticleReader } from "./article-reader";
import { type CaptureWatch, captureWatchQuery, NO_CAPTURE_WATCH } from "./capture-watch";
import type {
	ArticleReaderDeps,
	ArticleSnapshot,
	PollUrlBuilder,
	ReaderViewFailedOob,
} from "./article-reader.types";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../article-body/reader-slot/section-pages";

const TEST_READER_SECTION = { requested: undefined, readerPath: "/queue/a/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES };

const ARTICLE_URL = "https://example.com/post";

function makeSnapshot(): ArticleSnapshot {
	return {
		url: ARTICLE_URL,
		metadata: {
			title: "Post",
			siteName: "example.com",
			excerpt: "Excerpt.",
			wordCount: 100,
		},
		estimatedReadTime: 1 as Minutes,
	};
}

function makePollUrlBuilder(): PollUrlBuilder {
	return {
		summary: (n) => `/test/summary?poll=${n}`,
		reader: (n, capture) => `/test/reader?poll=${n}${captureWatchQuery(capture)}`,
	};
}

interface FakeState {
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: string | undefined;
	article: GlobalArticleData | null;
	contentFetchedAt: string | undefined;
	crawlVersions: ArticleCrawlVersion[];
}

const FIXED_NOW = new Date("2026-04-25T12:00:00.000Z");

function defaultFakeArticle(): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		url: ARTICLE_URL,
		destinationUrl: destinationUrl(ARTICLE_URL),
		metadata: {
			title: "Post",
			siteName: siteLabel("example.com"),
			excerpt: "Excerpt.",
			wordCount: 100,
		},
		estimatedReadTime: 1 as Minutes,
		savedAt: FIXED_NOW,
	};
}

function initFakeDeps(initial: {
	crawl?: ArticleCrawl;
	summary?: GeneratedSummary;
	content?: string;
	/** undefined means "use the default fake article"; null means "row missing". */
	article?: GlobalArticleData | null;
	/** Defaults to the public-reader behaviour (expanded) so existing assertions
	 * stay green; the collapse case overrides it to false. */
	summaryOpen?: boolean;
	contentFetchedAt?: string;
	crawlVersions?: ArticleCrawlVersion[];
	requestResolutionOnView?: RequestResolutionOnView;
	owner?: UserId;
} = {}): {
	state: FakeState;
	deps: ArticleReaderDeps;
	reads: { port: string; viewer: Viewer | undefined }[];
	ownerLookups: string[];
} {
	const reads: { port: string; viewer: Viewer | undefined }[] = [];
	const ownerLookups: string[] = [];
	const state: FakeState = {
		crawl: initial.crawl,
		summary: initial.summary,
		content: initial.content,
		article: initial.article === undefined ? defaultFakeArticle() : initial.article,
		contentFetchedAt: initial.contentFetchedAt,
		crawlVersions: initial.crawlVersions ?? [],
	};
	const deps: ArticleReaderDeps = {
		now: () => new Date("2026-11-05T10:00:00.000Z"),
		findArticleCrawlStatus: async () => state.crawl,
		findGeneratedSummary: async ({ url, viewer }) => {
			reads.push({ port: "findGeneratedSummary", viewer });
			return shownSummary({ url, viewer, ownerUserId: initial.owner, summary: state.summary });
		},
		readArticleContent: async ({ url, viewer }) => {
			reads.push({ port: "readArticleContent", viewer });
			return storedArticleBody({ url, html: state.content, viewer, ownerUserId: initial.owner });
		},
		findArticleByUrl: async (_url, viewer) => {
			reads.push({ port: "findArticleByUrl", viewer });
			return state.article;
		},
		findItemOwner: async (url) => {
			ownerLookups.push(url);
			return initial.owner;
		},
		findArticleCrawlVersions: async () => state.crawlVersions,
		findArticleFreshness: async () =>
			state.contentFetchedAt === undefined
				? null
				: { contentFetchedAt: state.contentFetchedAt },
		formatDocumentTitle: (title) => `${title} — TestReader`,
		appOrigin: "https://readplace.com",
		summaryOpen: initial.summaryOpen ?? true,
		requestResolutionOnView: initial.requestResolutionOnView,
	};
	return { state, deps, reads, ownerLookups };
}

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function toHtml(component: { to: (mediaType: "text/html") => { body: string } }): string {
	return component.to("text/html").body;
}

const SIX_HOURS_AGO = { iso: "2026-04-25T06:00:00.000Z", label: "6h ago", mode: "relative" } as const;

function headerOf(doc: Document): { facts: (string | null)[]; saved: string | null | undefined } {
	const header = doc.querySelector("#reader-article-meta");
	assert(header, "the header OOB fragment must accompany the slot");
	return {
		facts: Array.from(header.querySelectorAll("[data-test-reader-fact]"), (fact) =>
			fact.getAttribute("data-test-reader-fact"),
		),
		saved: header.querySelector("[data-test-reader-saved]")?.textContent,
	};
}

describe("initArticleReader", () => {
	describe("resolveReaderState", () => {
		it("returns content, crawl, summary and poll URLs when crawl and summary are pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawl).toEqual({ status: "pending", startedAt: "2026-11-05T10:00:00.000Z" });
			expect(result.summary).toEqual({ status: "pending" });
			expect(result.content).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
			expect(result.summaryPollUrl).toBe("/test/summary?poll=1");
		});

		it("maps the crawl-version log to newest-first versions, each carrying a date and a time", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
				contentFetchedAt: "2026-03-26T14:32:00.000Z",
				crawlVersions: [
					{ crawledAtMinute: "2026-07-10T09:14Z" },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
				],
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			// Provider versions win over the contentFetchedAt fallback.
			expect(result.crawlVersions).toEqual([
				{
					minuteId: "2026-07-10T09:14Z",
					date: { iso: "2026-07-10T09:14Z", label: "Jul 10, 2026", mode: "date" },
					time: { iso: "2026-07-10T09:14Z", label: "09:14 AM", mode: "time" },
				},
				{
					minuteId: "2026-06-28T22:01Z",
					date: { iso: "2026-06-28T22:01Z", label: "Jun 28, 2026", mode: "date" },
					time: { iso: "2026-06-28T22:01Z", label: "10:01 PM", mode: "time" },
				},
			]);
		});

		it("caps Article history at the newest 10 versions even though the stored log is unbounded", async () => {
			// 12 newest-first stored versions.
			const stored: ArticleCrawlVersion[] = Array.from({ length: 12 }, (_v, i) => ({
				crawledAtMinute: `2026-07-${String(12 - i).padStart(2, "0")}T09:14Z`,
			}));
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
				contentFetchedAt: "2026-03-26T14:32:00.000Z",
				crawlVersions: stored,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawlVersions).toHaveLength(10);
			expect(result.crawlVersions.map((version) => version.minuteId)).toEqual([
				"2026-07-12T09:14Z",
				"2026-07-11T09:14Z",
				"2026-07-10T09:14Z",
				"2026-07-09T09:14Z",
				"2026-07-08T09:14Z",
				"2026-07-07T09:14Z",
				"2026-07-06T09:14Z",
				"2026-07-05T09:14Z",
				"2026-07-04T09:14Z",
				"2026-07-03T09:14Z",
			]);
		});

		it("falls back to a single crawlVersions element from contentFetchedAt when the version log is empty", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
				contentFetchedAt: "2026-03-26T14:32:00.000Z",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawlVersions).toEqual([
				{
					minuteId: "2026-03-26T14:32:00.000Z",
					date: { iso: "2026-03-26T14:32:00.000Z", label: "Mar 26, 2026", mode: "date" },
					time: { iso: "2026-03-26T14:32:00.000Z", label: "02:32 PM", mode: "time" },
				},
			]);
		});

		it("leaves crawlVersions empty before the first crawl records a contentFetchedAt", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawlVersions).toEqual([]);
		});

		it("omits readerPollUrl when the crawl is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerPollUrl).toBeUndefined();
			expect(result.content).toBe("<p>body</p>");
			expect(result.summaryPollUrl).toBe("/test/summary?poll=1");
		});

		it("omits summaryPollUrl when the summary is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.summaryPollUrl).toBeUndefined();
			expect(result.summary).toEqual({ status: "ready", summary: "TL;DR" });
		});

		it("omits readerPollUrl when the crawl has failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
				summary: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerPollUrl).toBeUndefined();
			expect(result.crawl).toEqual({ status: "failed", reason: "blocked", outcomeRevision: 1 });
		});

		it("does NOT re-prime a legacy stub from the reader path (auto-heal removed; recovery is operator-driven via /admin/recrawl)", async () => {
			const { deps } = initFakeDeps({
				crawl: undefined,
				summary: undefined,
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			// crawl + summary stay undefined; the read-after-write race branch in
			// shouldKeepPollingReader still emits a poll URL so the page keeps
			// asking while the stale-check Lambda decides what to do.
			expect(result.crawl).toBeUndefined();
			expect(result.summary).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
			expect(result.summaryPollUrl).toBe("/test/summary?poll=1");
		});

		it("emits readerPollUrl when crawl is undefined with no content (read-after-write race)", async () => {
			const { deps } = initFakeDeps({
				crawl: undefined,
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawl).toBeUndefined();
			expect(result.content).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
		});

		it("omits readerPollUrl when crawl is undefined but content is present (legacy row)", async () => {
			const { deps } = initFakeDeps({
				crawl: undefined,
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerPollUrl).toBeUndefined();
		});

		it("emits readerPollUrl when crawl is ready but content is undefined (promotion race)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawl).toEqual({ status: "ready" });
			expect(result.content).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
		});

		it("derives a failed reader view with unavailable content when the crawl has failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "failed", contentUnavailable: true });
		});

		it("derives a failed reader view with available content when only the summary has failed on a ready crawl — the article rendered", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "failed", reason: "model timeout" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "failed", contentUnavailable: false });
		});

		it("derives a loading reader view while the crawl and summary are still pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "loading" });
		});

		it("derives a succeeded reader view once the crawl and summary are ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "succeeded" });
		});

		it("derives a loading reader view when the crawl and summary have no status yet", async () => {
			const { deps } = initFakeDeps({});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "loading" });
		});

		it("derives a succeeded reader view when the crawl is ready and the summary was skipped", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "skipped" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "succeeded" });
		});

		it("derives a failed reader view with unavailable content when the crawl is unsupported", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "unsupported", reason: "non-html" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerView).toEqual({ kind: "failed", contentUnavailable: true });
		});
	});

	describe("handleSummaryPoll", () => {
		it("emits a polling slot with the next poll URL when summary is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 3,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/summary?poll=4");
		});

		it("stops polling at MAX_POLLS", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("carries the summary panel's own progress in the slot it swaps, with no separate bar", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			const track = slot.querySelector('[data-test-progress-bar="summary"] [role="progressbar"]');
			assert(track, "the pending summary panel must carry its own progress track");
			expect(track.getAttribute("aria-valuenow")).toBe("90");
		});

		it("renders a ready summary expanded (summaryOpen: true) and stops polling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			const details = doc.querySelector(".tldr-disclosure");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(true);
		});

		it("renders a ready summary collapsed when the reader is configured summaryOpen: false (internal reader)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				summaryOpen: false,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: "/queue/abc/summary-toggle",
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const details = doc.querySelector(".tldr-disclosure");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(false);
			expect(details.getAttribute("data-summary-toggle-url")).toBe("/queue/abc/summary-toggle");
		});

		it("collapses the summary slot when the crawl has failed (no further polling)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("polls for a private upload", () => {
		const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const OWNER = UserIdSchema.parse("owner-1");

		function pollParams(viewer: Viewer, articleUrl: string) {
			return {
				viewer,
				enclosure: ABSENT_ENCLOSURE,
				articleUrl,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
				readerSection: TEST_READER_SECTION,
			};
		}

		function privateUploadReader() {
			const fake = initFakeDeps({
				crawl: { status: "ready" },
				content: "<p>PRIVATE-BOOK-BODY</p>",
				owner: OWNER,
			});
			return { ...fake, reader: initArticleReader(fake.deps) };
		}

		it.each([
			["a signed-out reader", ANONYMOUS_VIEWER],
			["another reader", viewerFor(UserIdSchema.parse("another-reader"))],
		])("answers %s's reader and summary polls with the not-an-article fragment", async (_name, viewer) => {
			const { reader } = privateUploadReader();

			const responses = [
				toHtml(await reader.handleReaderPoll(pollParams(viewer, PRIVATE_URL))),
				toHtml(await reader.handleSummaryPoll(pollParams(viewer, PRIVATE_URL))),
			];

			expect(responses.map((html) => parse(html).querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status"))).toEqual([
				"not-an-article",
				"not-an-article",
			]);
			expect(responses.filter((html) => html.includes("PRIVATE-BOOK-BODY"))).toEqual([]);
		});

		it("renders the body to its owner and reads every port as the owner", async () => {
			const { reader, reads } = privateUploadReader();
			const owner = viewerFor(OWNER);

			const html = toHtml(await reader.handleReaderPoll(pollParams(owner, PRIVATE_URL)));

			expect(html).toContain("PRIVATE-BOOK-BODY");
			expect(reads).toEqual([
				{ port: "findGeneratedSummary", viewer: owner },
				{ port: "readArticleContent", viewer: owner },
				{ port: "findArticleByUrl", viewer: owner },
			]);
		});

		it("reads no owner for an ordinary article's poll", async () => {
			const { reader, ownerLookups } = privateUploadReader();

			await reader.handleReaderPoll(pollParams(ANONYMOUS_VIEWER, ARTICLE_URL));
			await reader.handleSummaryPoll(pollParams(ANONYMOUS_VIEWER, ARTICLE_URL));

			expect(ownerLookups).toEqual([]);
		});
	});

	describe("handleReaderPoll", () => {
		it("emits the reader slot with the next poll URL when crawl is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 2,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=3");
		});

		it.each([
			["no-speech", "no-speech", null],
			["no recorded outcome", "pending", "/test/reader?poll=3"],
		] as const)("renders a pending crawl whose transcript notice is %s as %s", async (_label, status, pollUrl) => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 2,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: status === "no-speech" ? "no-speech" : undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe(status);
			expect(slot.getAttribute("hx-get")).toBe(pollUrl);
		});

		it("stops polling at MAX_POLLS and swaps to the 'Your link is saved' slow reframe", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("slow");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			const primary = doc.querySelector("[data-test-reader-failed-primary]");
			assert(primary, "primary source CTA must be rendered when the poll cap is reached");
			expect(primary.getAttribute("href")).toBe(ARTICLE_URL);
		});

		it("carries the reader panel's own progress in the slot it swaps, driven by the recorded crawl stage", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z", stage: "crawl-content-uploaded" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			const track = slot.querySelector('[data-test-progress-bar="reader"] [role="progressbar"]');
			assert(track, "the pending reader panel must carry its own progress track");
			expect(track.getAttribute("aria-valuenow")).toBe("90");
		});

		it("renders the ready reader with content when the crawl is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<article><p>Body</p></article>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("ready");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("emits the next poll URL when crawl is undefined with no content (read-after-write race)", async () => {
			const { deps } = initFakeDeps({
				crawl: undefined,
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 5,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=6");
		});

		it("emits the next poll URL when crawl is ready but content is undefined (promotion race)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 5,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=6");
		});

		it("stops at MAX_POLLS even when stuck in the promotion race", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("renders the reader as failed when the crawl has failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("failed");
		});

		it("includes the article header as an hx-swap-oob fragment carrying the latest title so the H1 settles in place once the crawl writes it over the hostname stub", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: siteLabel("example.com"),
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const title = doc.querySelector("#reader-article-title");
			assert(title, "title OOB fragment must accompany the reader-slot");
			expect(title.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(title.textContent).toBe("Why Rust beats Go");
			expect(doc.querySelector("#reader-article-meta")?.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(doc.querySelector("#article-header")).toBeNull();
			expect(doc.querySelector("#reader-readlist-tags")).toBeNull();
		});

		it("includes a <title> hx-swap-oob fragment formatted via deps.formatDocumentTitle so the browser tab updates without any client-side JS", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: siteLabel("example.com"),
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the reader-slot");
			expect(titleEl.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(titleEl.textContent).toBe("Why Rust beats Go — TestReader");
		});

		it("points the header's Original link at the redirect destination for a merged article", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				destinationUrl: destinationUrl("https://destination.example/article"),
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const header = doc.querySelector("#reader-article-meta");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);
		});

		it("carries the reader's saved time into the header it swaps in", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<p>body</p>",
				summary: { status: "ready", summary: "TL;DR" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: { kind: "web" },
				readerNotice: undefined,
				saved: SIX_HOURS_AGO,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(headerOf(parse(toHtml(component)))).toEqual({
				facts: ["site", "saved", "read-time", "provenance", "original"],
				saved: "6h ago",
			});
		});

		it("carries the stored publish date into the header it swaps in", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<p>body</p>",
				summary: { status: "ready", summary: "TL;DR" },
			});
			const article = defaultFakeArticle();
			state.article = { ...article, metadata: { ...article.metadata, publishedOn: "2025-10-08" } };
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: { kind: "web" },
				readerNotice: undefined,
				saved: SIX_HOURS_AGO,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			expect(headerOf(doc).facts).toEqual(["site", "published", "saved", "read-time", "provenance", "original"]);
			expect(doc.querySelector('#reader-article-meta [data-test-reader-fact="published"]')?.textContent).toBe(
				"Published Oct 8, 2025",
			);
		});

		it("keeps the header's Original link on the saved URL when no redirect was ever resolved", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const header = doc.querySelector("#reader-article-meta");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				ARTICLE_URL,
			);
		});

		it("sends the failed-slot CTA to the redirect destination for a merged article", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				destinationUrl: destinationUrl("https://destination.example/article"),
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const primary = doc.querySelector("[data-test-reader-failed-primary]");
			assert(primary, "primary source CTA must be rendered when the poll cap is reached");
			expect(primary.getAttribute("href")).toBe("https://destination.example/article");
			expect(primary.textContent?.trim()).toBe("Read original article");
		});

		it("omits the title, meta and <title> OOB fragments when the row has gone missing — falling back to swapping only the slot so the existing header text stays put", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				content: undefined,
				article: null,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			// Anchor on a positive: the reader-slot fragment must render even with
			// no article row. Only then are the absence checks below meaningful (a
			// typo'd selector would otherwise also return null and pass silently).
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader-slot fragment must still be emitted even with no article row");
			expect(doc.querySelector("#reader-article-title")).toBeNull();
			expect(doc.querySelector("#reader-article-meta")).toBeNull();
			expect(doc.querySelector("title#document-title")).toBeNull();
		});
	});

	describe("handleSummaryPoll header + title OOB", () => {
		it("emits the title, meta and <title> OOB fragments alongside the summary-slot so a settled title can land via the summary-poll path too (whichever poll fires first wins)", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: siteLabel("example.com"),
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const title = doc.querySelector("#reader-article-title");
			assert(title, "title OOB fragment must accompany the summary-slot");
			expect(title.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(title.textContent).toBe("Why Rust beats Go");
			expect(doc.querySelector("#reader-article-meta")?.getAttribute("hx-swap-oob")).toBe("outerHTML");
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the summary-slot");
			expect(titleEl.textContent).toBe("Why Rust beats Go — TestReader");
		});

		it("carries the reader's saved time into the header it swaps in", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<p>body</p>",
				summary: { status: "ready", summary: "TL;DR" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: { kind: "web" },
				readerNotice: undefined,
				saved: SIX_HOURS_AGO,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(headerOf(parse(toHtml(component)))).toEqual({
				facts: ["site", "saved", "read-time", "provenance", "original"],
				saved: "6h ago",
			});
		});

		it("points the header's Original link at the redirect destination for a merged article", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
			});
			state.article = {
				...defaultFakeArticle(),
				destinationUrl: destinationUrl("https://destination.example/article"),
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const header = doc.querySelector("#reader-article-meta");
			assert(header, "header OOB fragment must accompany the summary-slot");
			expect(header.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);
		});
	});

	/* Each slot has its
	 * own self-driven poll. If the page loads while one axis is terminal and
	 * later the recrawl pipeline flips that axis back to pending (e.g. admin
	 * recrawl reseeds summary when canonicalContentHash differs), the original
	 * page never armed a poll on that axis. The sibling poll has to hand the
	 * chain off, otherwise the bar stays visible forever with no live poll. */
	describe("cross-axis poll handoff", () => {
		it("handleReaderPoll emits an OOB summary slot with hx-get when summary has gone pending while reader is settling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-started" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "OOB summary slot must accompany the reader-poll response");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(summarySlot.getAttribute("hx-get")).toBe("/test/summary?poll=1");
		});

		it("handleReaderPoll emits a deferred OOB summary slot (hidden, still polling) while the crawl is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "OOB summary slot must accompany the reader-poll response");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(summarySlot.getAttribute("hx-get")).toBe("/test/summary?poll=1");
		});

		it("handleSummaryPoll emits an OOB reader slot with hx-get when crawl has gone pending while summary is settling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z", stage: "crawl-fetching" },
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "OOB reader slot must accompany the summary-poll response");
			expect(readerSlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(readerSlot.getAttribute("data-reader-status")).toBe("pending");
			expect(readerSlot.getAttribute("hx-get")).toBe("/test/reader?poll=1");
		});

		it("handleReaderPoll emits a terminal OOB summary slot (no hx-get) when summary is already ready — keeps the chain idempotent", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "OOB summary slot must accompany the reader-poll response");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("ready");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
		});

		it("handleSummaryPoll leaves the reader slot alone once the reader has settled on the article, so a pending summary does not re-swap the article body every tick", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(`<div id="poll-response">${toHtml(component)}</div>`);
			const response = doc.querySelector("#poll-response");
			assert(response, "poll response wrapper must parse");
			const swappedIds = Array.from(response.children).map((el) => el.id);
			expect(swappedIds).toEqual([
				"article-body-summary-slot",
				"reader-article-title",
				"reader-article-meta",
				"document-title",
				"article-body-reader-notice",
			]);
		});

		/* Original stuck-progress-bar reproduction. The /admin/recrawl page
		 * force-marks crawl pending while summary is still ready, then the
		 * recrawl pipeline asynchronously resets summary to pending once the
		 * new canonical hash differs. The reader poll observes crawl=ready +
		 * summary=pending and is about to stop polling itself — it MUST hand
		 * the chain to summary polling or the bar is stranded visible. */
		it("admin-recrawl scenario: reader poll about to settle while summary just flipped to pending hands off polling so the bar can eventually hide", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "reader slot present");
			expect(readerSlot.hasAttribute("hx-get")).toBe(false);
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be present as an OOB swap to keep the chain alive");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("hx-get")).toBe("/test/summary?poll=1");
			const track = summarySlot.querySelector('[data-test-progress-bar="summary"] [role="progressbar"]');
			assert(track, "the summary panel must carry its own progress track");
			expect(track.getAttribute("aria-valuenow")).toBe("29");
		});
	});

	describe("an on-device capture ends on the first poll that sees its outcome", () => {
		const BLOCKED = JSON.stringify({ kind: "blocked", cause: "edge-block" });

		async function capturePoll(params: {
			crawl: ArticleCrawl | undefined;
			capture: CaptureWatch;
			pollCount: number;
		}): Promise<Document> {
			const { deps } = initFakeDeps({ crawl: params.crawl, content: undefined });
			const component = await initArticleReader(deps).handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: "0123456789abcdef0123456789abcdef",
				pollCount: params.pollCount,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: params.capture,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});
			return parse(toHtml(component));
		}

		function regionsOf(doc: Document) {
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, "the notice region must be rendered");
			return {
				slot: { status: slot.getAttribute("data-reader-status"), poll: slot.getAttribute("hx-get") },
				notice: { status: notice.getAttribute("data-reader-status"), poll: notice.getAttribute("hx-get"), trigger: notice.getAttribute("hx-trigger") },
			};
		}

		it("shows the copy in progress at kick-off, polling with the rendered notice's revision as the baseline and listening for the device to give up", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 2 },
				capture: { kind: "started", noticeRevision: 2, trigger: "manual" },
				pollCount: 1,
			});

			expect(regionsOf(doc)).toEqual({
				slot: { status: "pending", poll: "/test/reader?poll=2&captureSince=2&captureTrigger=manual" },
				notice: {
					status: "none",
					poll: "/test/reader?poll=2&captureSince=2&captureGaveUp=1&captureTrigger=manual",
					trigger: "readplace-capture-failed from:document",
				},
			});
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, "the notice region must be rendered");
			expect([
				notice.getAttribute("hx-target"),
				notice.getAttribute("hx-swap"),
				notice.hasAttribute("data-background-request"),
			]).toEqual(["#article-body-reader-slot", "outerHTML show:none", true]);
		});

		it("carries an automatic capture's trigger onto the next poll and onto the device's give-up", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 2 },
				capture: { kind: "started", noticeRevision: 2, trigger: "automatic" },
				pollCount: 1,
			});

			expect([regionsOf(doc).slot.poll, regionsOf(doc).notice.poll]).toEqual([
				"/test/reader?poll=2&captureSince=2&captureTrigger=automatic",
				"/test/reader?poll=2&captureSince=2&captureGaveUp=1&captureTrigger=automatic",
			]);
		});

		it("takes the row's newer revision as the baseline at kick-off, so an outcome written before the tap is not mistaken for the capture's", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 3 },
				capture: { kind: "started", noticeRevision: 1, trigger: "manual" },
				pollCount: 1,
			});

			expect(regionsOf(doc).slot).toEqual({ status: "pending", poll: "/test/reader?poll=2&captureSince=3&captureTrigger=manual" });
		});

		it("renders the row's own notice on the first poll after the outcome revision moves past the baseline, offering a fresh capture from the new baseline", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: JSON.stringify({ kind: "capture-unreadable", detail: "none" }), outcomeRevision: 3 },
				capture: { kind: "watching", since: 2, trigger: "manual" },
				pollCount: 4,
			});

			expect(regionsOf(doc)).toEqual({
				slot: { status: "capture-unreadable", poll: null },
				notice: {
					status: "capture-unreadable",
					poll: "/test/reader?poll=1&captureNotice=3&captureTrigger=automatic",
					trigger: "readplace-capture-started from:document",
				},
			});
		});

		it("keeps copying when a lagging read shows a revision below the baseline, because only a higher revision is an outcome", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 2 },
				capture: { kind: "watching", since: 3, trigger: "manual" },
				pollCount: 4,
			});

			expect(regionsOf(doc).slot).toEqual({ status: "pending", poll: "/test/reader?poll=5&captureSince=3&captureTrigger=manual" });
		});

		it.each([
			{ when: "the device gave up", capture: { kind: "device-gave-up", since: 2, trigger: "manual" } as const, pollCount: 4 },
			{ when: "the capture budget is spent", capture: { kind: "watching", since: 2, trigger: "manual" } as const, pollCount: MAX_CAPTURE_POLLS },
		])("says a tapped copy never arrived when $when and nothing was judged, offering the capture again and polling no further", async ({ capture, pollCount }) => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 2 },
				capture,
				pollCount,
			});

			expect(regionsOf(doc)).toEqual({
				slot: { status: "capture-missing", poll: null },
				notice: {
					status: "capture-missing",
					poll: "/test/reader?poll=1&captureNotice=2&captureTrigger=automatic",
					trigger: "readplace-capture-started from:document",
				},
			});
			const captureControl = doc.querySelector('[data-test-reader-action="capture"]');
			assert(captureControl, "the capture-missing notice must render its capture control");
			expect(captureControl.classList.contains("article-body__reader-notice-capture--offered")).toBe(true);
		});

		it.each([
			{ when: "the device gave up", capture: { kind: "device-gave-up", since: 2, trigger: "automatic" } as const, pollCount: 4 },
			{ when: "the capture budget is spent", capture: { kind: "watching", since: 2, trigger: "automatic" } as const, pollCount: MAX_CAPTURE_POLLS },
		])("renders the row's stored notice when $when on an automatic capture, offering the capture again and polling no further", async ({ capture, pollCount }) => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 2 },
				capture,
				pollCount,
			});

			expect(regionsOf(doc)).toEqual({
				slot: { status: "blocked", poll: null },
				notice: {
					status: "blocked",
					poll: "/test/reader?poll=1&captureNotice=2&captureTrigger=automatic",
					trigger: "readplace-capture-started from:document",
				},
			});
			const captureControl = doc.querySelector('[data-test-reader-action="capture"]');
			assert(captureControl, "the stored notice must render its capture control");
			expect(captureControl.classList.contains("article-body__reader-notice-capture--offered")).toBe(true);
			expect(captureControl.getAttribute("data-reader-capture-poll")).toBe("/test/reader?poll=1&captureNotice=2&captureTrigger=manual");
		});

		it("renders the judged outcome rather than the missing copy when the device gives up after the row moved", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 3 },
				capture: { kind: "device-gave-up", since: 2, trigger: "manual" },
				pollCount: 4,
			});

			expect(regionsOf(doc).slot).toEqual({ status: "blocked", poll: null });
		});

		it.each([
			{ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } as const, capture: { kind: "started", noticeRevision: 1, trigger: "manual" } as const, next: "/test/reader?poll=3&captureSince=1&captureTrigger=manual" },
			{ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } as const, capture: { kind: "started", noticeRevision: 1, trigger: "automatic" } as const, next: "/test/reader?poll=3&captureSince=1&captureTrigger=automatic" },
			{ crawl: undefined, capture: { kind: "watching", since: 4, trigger: "manual" } as const, next: "/test/reader?poll=3&captureSince=4&captureTrigger=manual" },
			{ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } as const, capture: { kind: "device-gave-up", since: 4, trigger: "automatic" } as const, next: "/test/reader?poll=3&captureSince=4&captureGaveUp=1&captureTrigger=automatic" },
		])("carries a $capture.trigger $capture.kind watch over a row with no outcome yet onto the next poll", async ({ crawl, capture, next }) => {
			const doc = await capturePoll({ crawl, capture, pollCount: 2 });

			expect(regionsOf(doc).slot).toEqual({ status: "pending", poll: next });
		});

		it.each([
			{ crawl: { status: "ready" } as const, status: "pending" },
			{ crawl: { status: "unsupported", reason: "non-html" } as const, status: "unsupported" },
		])("drops the watch once the row is $crawl.status, which is itself the capture's outcome", async ({ crawl, status }) => {
			const doc = await capturePoll({ crawl, capture: { kind: "watching", since: 2, trigger: "manual" }, pollCount: 3 });

			expect(regionsOf(doc).slot).toEqual({ status, poll: status === "pending" ? "/test/reader?poll=4" : null });
		});

		it("leaves a failed crawl unpolled when no capture is in flight", async () => {
			const doc = await capturePoll({
				crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 1 },
				capture: NO_CAPTURE_WATCH,
				pollCount: 1,
			});

			expect(regionsOf(doc).slot).toEqual({ status: "blocked", poll: null });
		});

		it("mints one capture kick-off URL per trigger from the rendered failure's revision, and none for a row that has not failed", async () => {
			const failed = initFakeDeps({ crawl: { status: "failed", reason: BLOCKED, outcomeRevision: 5 }, content: undefined });
			const pending = initFakeDeps({ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" }, content: undefined });

			const states = await Promise.all(
				[failed, pending].map(({ deps }) =>
					initArticleReader(deps).resolveReaderState({ viewer: ANONYMOUS_VIEWER, article: makeSnapshot(), pollUrlBuilder: makePollUrlBuilder() }),
				),
			);

			expect(states.map((state) => state.capturePollUrls)).toEqual([
				{
					manual: "/test/reader?poll=1&captureNotice=5&captureTrigger=manual",
					automatic: "/test/reader?poll=1&captureNotice=5&captureTrigger=automatic",
				},
				undefined,
			]);
		});
	});

	describe("the notice region rides every poll out of band", () => {
		it("answers a pending→failed reader poll with the empty in-card marker as the primary piece and the visible notice last", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }) },
				summary: { status: "skipped" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 2,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const doc = parse(toHtml(component));
			const primary = doc.body.firstElementChild;
			assert(primary, "the poll must answer with a primary piece");
			expect([
				primary.id,
				primary.getAttribute("hx-swap-oob"),
				primary.getAttribute("data-reader-status"),
				primary.classList.contains("article-body__reader-slot--notice"),
				primary.children.length,
			]).toEqual(["article-body-reader-slot", null, "not-found", true, 0]);
			const notice = doc.body.lastElementChild;
			assert(notice, "the poll must answer with the notice region");
			expect([
				notice.id,
				notice.getAttribute("hx-swap-oob"),
				notice.getAttribute("data-reader-status"),
				notice.classList.contains("article-body__reader-notice--visible"),
			]).toEqual(["article-body-reader-notice", "outerHTML", "not-found", true]);
			expect(notice.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href")).toBe(ARTICLE_URL);
		});

		it("hides the notice out of band on a summary poll once the reader view is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			const notice = parse(toHtml(component)).body.lastElementChild;
			assert(notice, "the poll must answer with the notice region");
			expect([
				notice.id,
				notice.getAttribute("hx-swap-oob"),
				notice.getAttribute("data-reader-status"),
				notice.classList.contains("article-body__reader-notice--hidden"),
			]).toEqual(["article-body-reader-notice", "outerHTML", "none", true]);
		});
	});

	describe("the table of contents travels with the reader slot", () => {
		const HEADED_CONTENT = "<h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p>";

		function pollParams() {
			return {
				viewer: ANONYMOUS_VIEWER,
				enclosure: ABSENT_ENCLOSURE,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: () => "",
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
				readerSection: TEST_READER_SECTION,
			};
		}

		function readTimeOf(doc: Document): string | undefined {
			return doc.querySelector('#reader-article-meta [data-test-reader-fact="read-time"]')?.textContent?.trim();
		}

		const OWNED_AUDIO: EnclosureRead = {
			kind: "owned",
			enclosure: { object: `objects/sha256/${"c".repeat(64)}/1`, mediaType: "audio/mpeg", durationSeconds: 2820 },
		};

		it("labels the header handleReaderPoll swaps in with the listen time of an owned enclosure", async () => {
			const { deps } = initFakeDeps({ crawl: { status: "ready" }, summary: { status: "pending" }, content: "<p>body</p>" });
			const reader = initArticleReader(deps);

			const owned = parse(toHtml(await reader.handleReaderPoll({ ...pollParams(), enclosure: OWNED_AUDIO })));
			const absent = parse(toHtml(await reader.handleReaderPoll(pollParams())));

			expect([readTimeOf(owned), readTimeOf(absent)]).toEqual(["47 min listen", "1 min read"]);
		});

		it("labels the header handleSummaryPoll swaps in with the listen time of an owned enclosure", async () => {
			const { deps } = initFakeDeps({ crawl: { status: "ready" }, summary: { status: "ready", summary: "TL;DR" }, content: "<p>body</p>" });
			const reader = initArticleReader(deps);

			const owned = parse(toHtml(await reader.handleSummaryPoll({ ...pollParams(), enclosure: OWNED_AUDIO })));
			const absent = parse(toHtml(await reader.handleSummaryPoll(pollParams())));

			expect([readTimeOf(owned), readTimeOf(absent)]).toEqual(["47 min listen", "1 min read"]);
		});

		function tableOfContentsOf(doc: Document): Element {
			const wrapper = doc.querySelector("#table-of-contents");
			assert(wrapper, "the poll must carry the table of contents");
			return wrapper;
		}

		it("lands the listed card in the same reader-poll response as the article, linking to the slot's headings", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: HEADED_CONTENT,
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleReaderPoll(pollParams())));

			const wrapper = tableOfContentsOf(doc);
			const headingIds = Array.from(doc.querySelectorAll("[data-test-reader-content] h2, [data-test-reader-content] h3"), (heading) => `#${heading.id}`);
			expect([
				wrapper.getAttribute("data-test-table-of-contents"),
				wrapper.getAttribute("hx-swap-oob"),
				Array.from(wrapper.querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href")),
			]).toEqual(["listed", "outerHTML", headingIds]);
			expect(headingIds).toEqual(["#section-why-it-matters", "#section-how-to-start"]);
		});

		it("leaves the article's own title out of the card that handleReaderPoll lands, while the slot keeps the heading", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: `<h2>Post</h2>${HEADED_CONTENT}`,
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleReaderPoll(pollParams())));

			expect([
				Array.from(tableOfContentsOf(doc).querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href")),
				Array.from(doc.querySelectorAll("[data-test-reader-content] h2"), (heading) => heading.id),
			]).toEqual([
				["#section-why-it-matters", "#section-how-to-start"],
				["section-post", "section-why-it-matters"],
			]);
		});

		it("lists a heading that repeats nothing when the article row has gone missing", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: `<h2>Post</h2>${HEADED_CONTENT}`,
				article: null,
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleReaderPoll(pollParams())));

			expect(Array.from(tableOfContentsOf(doc).querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href"))).toEqual([
				"#section-post",
				"#section-why-it-matters",
				"#section-how-to-start",
			]);
		});

		it("keeps the card hidden when a pending reader poll lands on a failed crawl", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }) },
				summary: { status: "skipped" },
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleReaderPoll(pollParams())));

			const wrapper = tableOfContentsOf(doc);
			expect([wrapper.getAttribute("data-test-table-of-contents"), wrapper.getAttribute("hx-swap-oob")]).toEqual([
				"hidden",
				"outerHTML",
			]);
		});

		it("carries the card beside the reader slot on a summary poll while the reader is still polling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z", stage: "crawl-fetching" },
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleSummaryPoll(pollParams())));

			const wrapper = tableOfContentsOf(doc);
			expect([
				wrapper.previousElementSibling?.id,
				wrapper.getAttribute("data-test-table-of-contents"),
				wrapper.getAttribute("hx-swap-oob"),
			]).toEqual(["article-body-reader-slot", "hidden", "outerHTML"]);
		});

		it("leaves the card out of a summary poll once the reader has settled on the article, so its open state and focus survive the tick", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: HEADED_CONTENT,
			});
			const reader = initArticleReader(deps);

			const doc = parse(toHtml(await reader.handleSummaryPoll(pollParams())));

			expect(Array.from(doc.body.children, (piece) => piece.id)).toEqual([
				"article-body-summary-slot",
				"reader-article-title",
				"reader-article-meta",
				"document-title",
				"article-body-reader-notice",
			]);
		});
	});

	describe("readerViewFailedOob emission (settled + failed only)", () => {
		const PROBE: ReaderViewFailedOob = (failure) =>
			`<div id="reader-view-failed-probe" data-content-unavailable="${failure.readerContentUnavailable}" hx-swap-oob="outerHTML"></div>`;

		function probeContentUnavailable(component: {
			to: (mediaType: "text/html") => { body: string };
		}): string | null {
			const probe = parse(toHtml(component)).querySelector("#reader-view-failed-probe");
			assert(probe, "the reader-view-failed fragment must be emitted");
			return probe.getAttribute("data-content-unavailable");
		}

		function oobIds(component: {
			to: (mediaType: "text/html") => { body: string };
		}): string[] {
			return Array.from(
				parse(toHtml(component)).querySelectorAll("[hx-swap-oob]"),
			).map((el) => el.id);
		}

		const READER_POLL_BASELINE = [
			"article-body-summary-slot",
			"table-of-contents",
			"reader-article-title",
			"reader-article-meta",
			"document-title",
		];
		const SUMMARY_POLL_BASELINE = [
			"article-body-reader-slot",
			"table-of-contents",
			"reader-article-title",
			"reader-article-meta",
			"document-title",
		];

		it("appends the fragment on a reader poll once the crawl has failed and both chains are settled, telling it the reader has no content", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
				summary: { status: "skipped" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([
				...READER_POLL_BASELINE,
				"reader-view-failed-probe",
				"article-body-reader-notice",
			]);
			expect(probeContentUnavailable(component)).toBe("true");
		});

		it("appends the fragment on a summary poll once the summary has failed on a ready crawl, telling it the article rendered", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "failed", reason: "model timeout" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([
				"reader-article-title",
				"reader-article-meta",
				"document-title",
				"reader-view-failed-probe",
				"article-body-reader-notice",
			]);
			expect(probeContentUnavailable(component)).toBe("false");
		});

		it("omits the fragment while the reader chain is still polling through the content-promotion race, even though the summary failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "failed", reason: "model timeout" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([...READER_POLL_BASELINE, "article-body-reader-notice"]);
		});

		it("omits the fragment on a summary poll while the reader chain is still polling on a pending crawl", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "failed", reason: "model timeout" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([...SUMMARY_POLL_BASELINE, "article-body-reader-notice"]);
		});

		it("omits the fragment while the reader view is still loading (crawl and summary pending)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([...READER_POLL_BASELINE, "article-body-reader-notice"]);
		});

		it("omits the fragment once the reader view has succeeded (crawl and summary ready)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
				readerSection: TEST_READER_SECTION,
				viewer: ANONYMOUS_VIEWER,
				articleUrl: ARTICLE_URL,
				articleId: undefined,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				capture: NO_CAPTURE_WATCH,
				extensionInstallUrl: undefined,
				summaryToggleUrl: undefined,
				provenance: undefined,
				readerNotice: undefined,
				saved: undefined,
				readerViewFailedOob: PROBE,
				renderDownloadsOob: undefined,
				renderShareOob: undefined,
			});

			expect(oobIds(component)).toEqual([...READER_POLL_BASELINE, "article-body-reader-notice"]);
		});
	});
	describe("a link whose host can never hold an article", () => {
		const GATED_URL = "https://mail.google.com/mail/u/0/";
		const FAILURE_PROBE = () => '<p id="failure-probe"></p>';

		function gatedSnapshot(): ArticleSnapshot {
			return {
				url: GATED_URL,
				metadata: {
					title: "Inbox (42) — someone@example.com",
					siteName: "mail.google.com",
					excerpt: "Re: your invoice",
					wordCount: 400,
				},
				estimatedReadTime: 2 as Minutes,
			};
		}

		it("resolves to a state carrying nothing the crawl produced, with both poll chains disarmed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "Your inbox has 42 unread messages." },
				content: "<p>Re: your invoice</p>",
				contentFetchedAt: "2026-04-25T11:00:00.000Z",
				crawlVersions: [{ crawledAtMinute: "2026-04-25T11:00", authorUserId: undefined }],
			});
			const reader = initArticleReader(deps);

			const state = await reader.resolveReaderState({
				viewer: ANONYMOUS_VIEWER,
				article: gatedSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(state).toEqual({
				content: undefined,
				crawl: undefined,
				summary: undefined,
				readerPollUrl: undefined,
				summaryPollUrl: undefined,
				capturePollUrls: undefined,
				crawlVersions: [],
				readerView: { kind: "not-an-article" },
			});
		});

		it("answers a reader poll with the terminal notice, a collapsed summary and no further tick", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "Your inbox has 42 unread messages." },
				content: "<p>Re: your invoice</p>",
			});
			const reader = initArticleReader(deps);

			const doc = parse(
				toHtml(
					await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
						readerSection: TEST_READER_SECTION,
						viewer: ANONYMOUS_VIEWER,
						articleUrl: GATED_URL,
						articleId: undefined,
						pollCount: 1,
						pollUrlBuilder: makePollUrlBuilder(),
						capture: NO_CAPTURE_WATCH,
						extensionInstallUrl: "/install?client=chrome",
						summaryToggleUrl: undefined,
						provenance: undefined,
						readerNotice: undefined,
						saved: undefined,
						readerViewFailedOob: FAILURE_PROBE,
						renderDownloadsOob: undefined,
						renderShareOob: undefined,
					}),
				),
			);

			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			assert.equal(slot.getAttribute("data-reader-status"), "not-an-article");
			assert.equal(slot.getAttribute("hx-get"), null);
			assert.equal(slot.children.length, 0);
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, "the gate must answer with the visible notice");
			assert.deepEqual(
				[notice.getAttribute("data-reader-status"), notice.classList.contains("article-body__reader-notice--visible")],
				["not-an-article", true],
			);

			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			assert.equal(summarySlot.getAttribute("hx-get"), null);
			assert.equal(summarySlot.textContent, "");

			assert.equal(doc.querySelector("#failure-probe"), null);
		});

		it("keeps the table of contents hidden, since the gated link has no article to list", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<h2>Inbox</h2><p>Re: your invoice</p>",
			});
			const reader = initArticleReader(deps);

			const doc = parse(
				toHtml(
					await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
						readerSection: TEST_READER_SECTION,
						viewer: ANONYMOUS_VIEWER,
						articleUrl: GATED_URL,
						articleId: undefined,
						pollCount: 1,
						pollUrlBuilder: makePollUrlBuilder(),
						capture: NO_CAPTURE_WATCH,
						extensionInstallUrl: undefined,
						summaryToggleUrl: undefined,
						provenance: undefined,
						readerNotice: undefined,
						saved: undefined,
						readerViewFailedOob: FAILURE_PROBE,
						renderDownloadsOob: undefined,
						renderShareOob: undefined,
					}),
				),
			);

			const wrapper = doc.querySelector("#table-of-contents");
			assert(wrapper, "the gated poll must still carry the table of contents target");
			assert.deepEqual(
				[wrapper.getAttribute("data-test-table-of-contents"), wrapper.getAttribute("hx-swap-oob")],
				["hidden", "outerHTML"],
			);
		});

		it("answers a summary poll with the same terminal pair", async () => {
			const { deps } = initFakeDeps({ crawl: { status: "ready" }, content: "<p>body</p>" });
			const reader = initArticleReader(deps);

			const doc = parse(
				toHtml(
					await reader.handleSummaryPoll({ enclosure: ABSENT_ENCLOSURE,
						readerSection: TEST_READER_SECTION,
						viewer: ANONYMOUS_VIEWER,
						articleUrl: GATED_URL,
						articleId: undefined,
						pollCount: 1,
						pollUrlBuilder: makePollUrlBuilder(),
						capture: NO_CAPTURE_WATCH,
						extensionInstallUrl: undefined,
						summaryToggleUrl: undefined,
						provenance: undefined,
						readerNotice: undefined,
						saved: undefined,
						readerViewFailedOob: FAILURE_PROBE,
						renderDownloadsOob: undefined,
						renderShareOob: undefined,
					}),
				),
			);

			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			assert.equal(summarySlot.getAttribute("hx-get"), null);
			assert.equal(
				doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status"),
				"not-an-article",
			);
		});

		it("swaps the document title back to the hostname stub, never the stored one", async () => {
			const { deps } = initFakeDeps({ crawl: { status: "ready" }, content: "<p>body</p>" });
			const reader = initArticleReader(deps);

			const doc = parse(
				toHtml(
					await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
						readerSection: TEST_READER_SECTION,
						viewer: ANONYMOUS_VIEWER,
						articleUrl: GATED_URL,
						articleId: undefined,
						pollCount: 1,
						pollUrlBuilder: makePollUrlBuilder(),
						capture: NO_CAPTURE_WATCH,
						extensionInstallUrl: undefined,
						summaryToggleUrl: undefined,
						provenance: undefined,
						readerNotice: undefined,
						saved: undefined,
						readerViewFailedOob: FAILURE_PROBE,
						renderDownloadsOob: undefined,
						renderShareOob: undefined,
					}),
				),
			);

			assert.equal(
				doc.querySelector("#document-title")?.textContent,
				"mail.google.com — TestReader",
			);
			assert.equal(
				doc.querySelector("#reader-article-title")?.textContent?.trim(),
				"mail.google.com",
			);
		});

		it("swaps in a stub header with only the site, read time and Original, whatever the reader's save carries", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<p>body</p>",
				summary: { status: "ready", summary: "TL;DR" },
			});
			const article = defaultFakeArticle();
			state.article = { ...article, metadata: { ...article.metadata, publishedOn: "2025-10-08" } };
			const reader = initArticleReader(deps);

			const doc = parse(
				toHtml(
					await reader.handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
						readerSection: TEST_READER_SECTION,
						viewer: ANONYMOUS_VIEWER,
						articleUrl: GATED_URL,
						articleId: undefined,
						pollCount: 1,
						pollUrlBuilder: makePollUrlBuilder(),
						capture: NO_CAPTURE_WATCH,
						extensionInstallUrl: undefined,
						summaryToggleUrl: undefined,
						provenance: { kind: "web" },
						readerNotice: undefined,
						saved: SIX_HOURS_AGO,
						readerViewFailedOob: FAILURE_PROBE,
						renderDownloadsOob: undefined,
						renderShareOob: undefined,
					}),
				),
			);

			assert.deepEqual(headerOf(doc), {
				facts: ["site", "read-time", "original"],
				saved: undefined,
			});
			const header = doc.querySelector("#reader-article-meta");
			assert(header, "the stub header must swap in");
			assert(doc.querySelector("#reader-article-title"), "the stub title must swap in");
			assert.equal(doc.querySelector("#reader-readlist-tags"), null);
		});
	});
});

describe("resolveReaderStateFrom", () => {
	it("renders the state it is handed instead of reading the crawl and summary again", async () => {
		const { deps } = initFakeDeps({ crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" }, content: undefined });

		const state = await initArticleReader(deps).resolveReaderStateFrom(
			{ viewer: ANONYMOUS_VIEWER, article: makeSnapshot(), pollUrlBuilder: makePollUrlBuilder() },
			{
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				summary: shownSummary({ url: makeSnapshot().url, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined, summary: { status: "pending" } }),
			},
		);

		expect({ crawl: state.crawl, summary: state.summary, readerPollUrl: state.readerPollUrl, summaryPollUrl: state.summaryPollUrl }).toEqual({
			crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
			summary: { status: "pending" },
			readerPollUrl: "/test/reader?poll=1",
			summaryPollUrl: "/test/summary?poll=1",
		});
	});

	it("gates a link whose host can never hold an article", async () => {
		const { deps } = initFakeDeps();

		const state = await initArticleReader(deps).resolveReaderStateFrom(
			{ viewer: ANONYMOUS_VIEWER, article: { ...makeSnapshot(), url: "https://mail.google.com/mail/u/0/" }, pollUrlBuilder: makePollUrlBuilder() },
			{ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" }, summary: undefined },
		);

		expect(state.readerView).toEqual({ kind: "not-an-article" });
	});
});

describe("the reader's gave-up poll", () => {
	const EDGE_BLOCK = JSON.stringify({ kind: "blocked", cause: "edge-block" });
	type ResolutionCall = Parameters<RequestResolutionOnView>[0];

	function recordingResolution(answer: (call: ResolutionCall) => ReturnType<RequestResolutionOnView>) {
		const calls: ResolutionCall[] = [];
		const requestResolutionOnView: RequestResolutionOnView = (call) => {
			calls.push(call);
			return answer(call);
		};
		return { calls, requestResolutionOnView };
	}

	const claimPending = recordingResolution;
	const pendingAnswer = async (call: ResolutionCall) =>
		new Map(
			call.articles.map(({ url }) => [
				url,
				{ crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } as const, summary: shownSummary({ url, viewer: call.viewer, ownerUserId: undefined, summary: { status: "pending" } }) },
			]),
		);

	async function gaveUpPoll(params: {
		crawl: ArticleCrawl;
		capture: CaptureWatch;
		requestResolutionOnView: RequestResolutionOnView;
	}): Promise<Document> {
		const { deps } = initFakeDeps({ crawl: params.crawl, content: undefined, requestResolutionOnView: params.requestResolutionOnView });
		const component = await initArticleReader(deps).handleReaderPoll({ enclosure: ABSENT_ENCLOSURE,
			readerSection: TEST_READER_SECTION,
			viewer: ANONYMOUS_VIEWER,
			articleUrl: ARTICLE_URL,
			articleId: "0123456789abcdef0123456789abcdef",
			pollCount: 2,
			pollUrlBuilder: makePollUrlBuilder(),
			capture: params.capture,
			extensionInstallUrl: undefined,
			summaryToggleUrl: undefined,
			provenance: undefined,
			readerNotice: undefined,
			saved: undefined,
			readerViewFailedOob: () => "",
			renderDownloadsOob: undefined,
			renderShareOob: undefined,
		});
		return parse(toHtml(component));
	}

	it("claims the paid legs for a block-evidence row the device gave up on and renders the reader pending", async () => {
		const resolution = claimPending(pendingAnswer);

		const doc = await gaveUpPoll({
			crawl: { status: "failed", reason: EDGE_BLOCK, outcomeRevision: 2 },
			capture: { kind: "device-gave-up", since: 2, trigger: "manual" },
			requestResolutionOnView: resolution.requestResolutionOnView,
		});

		expect(resolution.calls).toEqual([
			{
				surface: "reader-capture-gave-up",
				viewer: ANONYMOUS_VIEWER,
				viewerCanCapture: false,
				articles: [{ url: ARTICLE_URL, crawl: { status: "failed", reason: EDGE_BLOCK, outcomeRevision: 2 }, summary: undefined }],
			},
		]);
		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect({ status: slot.getAttribute("data-reader-status"), poll: slot.getAttribute("hx-get") }).toEqual({
			status: "pending",
			poll: "/test/reader?poll=3&captureSince=2&captureGaveUp=1&captureTrigger=manual",
		});
	});

	it.each([
		{ when: "the device is still copying", crawl: { status: "failed", reason: EDGE_BLOCK, outcomeRevision: 2 } as const, capture: { kind: "watching", since: 2, trigger: "manual" } as const },
		{ when: "a newer outcome than the one the device gave up on landed", crawl: { status: "failed", reason: EDGE_BLOCK, outcomeRevision: 3 } as const, capture: { kind: "device-gave-up", since: 2, trigger: "manual" } as const },
		{ when: "the row is already pending", crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } as const, capture: { kind: "device-gave-up", since: 2, trigger: "manual" } as const },
		{
			when: "the row has no block evidence",
			crawl: { status: "failed", reason: JSON.stringify({ kind: "capture-unreadable", detail: "none" }), outcomeRevision: 2 } as const,
			capture: { kind: "device-gave-up", since: 2, trigger: "manual" } as const,
		},
	])("claims nothing when $when", async ({ crawl, capture }) => {
		const resolution = claimPending(pendingAnswer);

		await gaveUpPoll({ crawl, capture, requestResolutionOnView: resolution.requestResolutionOnView });

		expect(resolution.calls).toEqual([]);
	});

	it("renders the loaded failed row when the resolution leaves the gave-up row out", async () => {
		const resolution = claimPending(async () => new Map());

		const doc = await gaveUpPoll({
			crawl: { status: "failed", reason: EDGE_BLOCK, outcomeRevision: 2 },
			capture: { kind: "device-gave-up", since: 2, trigger: "automatic" },
			requestResolutionOnView: resolution.requestResolutionOnView,
		});

		expect(resolution.calls).toHaveLength(1);
		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect({ status: slot.getAttribute("data-reader-status"), poll: slot.getAttribute("hx-get") }).toEqual({
			status: "blocked",
			poll: null,
		});
	});
});
