import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { GlobalArticleData } from "@packages/test-fixtures/providers/article-store";
import { MAX_POLLS, initArticleReader } from "./article-reader";
import type {
	ArticleReaderDeps,
	ArticleSnapshot,
	PollUrlBuilder,
} from "./article-reader.types";

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
		reader: (n) => `/test/reader?poll=${n}`,
	};
}

interface FakeState {
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	content: string | undefined;
	article: GlobalArticleData | null;
	markCrawlPendingCalls: number;
	markSummaryPendingCalls: number;
}

const FIXED_NOW = new Date("2026-04-25T12:00:00.000Z");

function defaultFakeArticle(): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
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

function initFakeDeps(initial: {
	crawl?: ArticleCrawl;
	summary?: GeneratedSummary;
	content?: string;
	/** undefined means "use the default fake article"; null means "row missing". */
	article?: GlobalArticleData | null;
} = {}): {
	state: FakeState;
	deps: ArticleReaderDeps;
} {
	const state: FakeState = {
		crawl: initial.crawl,
		summary: initial.summary,
		content: initial.content,
		article: initial.article === undefined ? defaultFakeArticle() : initial.article,
		// Auto-heal was removed: the reader no longer marks anything pending.
		// The counters stay so the regression test can assert they don't tick.
		markCrawlPendingCalls: 0,
		markSummaryPendingCalls: 0,
	};
	const deps: ArticleReaderDeps = {
		findArticleCrawlStatus: async () => state.crawl,
		findGeneratedSummary: async () => state.summary,
		readArticleContent: async () => state.content,
		findArticleByUrl: async () => state.article,
		formatDocumentTitle: (title) => `${title} — TestReader`,
		now: () => FIXED_NOW,
	};
	return { state, deps };
}

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function toHtml(component: { to: (mediaType: "text/html") => { body: string } }): string {
	return component.to("text/html").body;
}

describe("initArticleReader", () => {
	describe("resolveReaderState", () => {
		it("returns content, crawl, summary and poll URLs when crawl and summary are pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				summary: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawl).toEqual({ status: "pending" });
			expect(result.summary).toEqual({ status: "pending" });
			expect(result.content).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
			expect(result.summaryPollUrl).toBe("/test/summary?poll=1");
		});

		it("emits a unified progress tick driven by the crawl stage while crawl is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", stage: "crawl-parsed" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "crawl-parsed",
				pct: 29,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("falls back to crawl-fetching at the bottom of the bar when no crawl stage has been recorded yet", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "crawl-fetching",
				pct: 5,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("scales pct inside the comprehensive-extracting → crawl-parsed band when per-part progress is reported", async () => {
			const { deps } = initFakeDeps({
				crawl: {
					status: "pending",
					stage: "comprehensive-extracting",
					parts: { current: 1, total: 2 },
				},
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "comprehensive-extracting",
				pct: 26,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("emits stage-base pct when stage=comprehensive-extracting and no parts have been recorded yet", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", stage: "comprehensive-extracting" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "comprehensive-extracting",
				pct: 23,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("does not scale pct on stages outside the comprehensive-extracting band (parts are ignored on other stages)", async () => {
			const { deps } = initFakeDeps({
				crawl: {
					status: "pending",
					stage: "crawl-fetching",
					parts: { current: 1, total: 2 },
				},
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "crawl-fetching",
				pct: 5,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("clamps the scaled pct at the top of the band when parts.current === parts.total", async () => {
			const { deps } = initFakeDeps({
				crawl: {
					status: "pending",
					stage: "comprehensive-extracting",
					parts: { current: 4, total: 4 },
				},
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "comprehensive-extracting",
				pct: 29,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("hands the unified bar over to the summary stage once the crawl has gone ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "summary-generating",
				pct: 90,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("falls back to summary-started at the bottom of the summary range when no summary stage has been recorded yet", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toEqual({
				stage: "summary-started",
				pct: 65,
				tickAt: FIXED_NOW.toISOString(),
			});
		});

		it("hides the bar once both pipelines are terminal", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toBeUndefined();
		});

		it("hides the bar when the crawl has failed (summary slot collapses; the bar would just stall)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", reason: "blocked" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.progress).toBeUndefined();
		});

		it("omits readerPollUrl when the crawl is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
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
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.summaryPollUrl).toBeUndefined();
			expect(result.summary).toEqual({ status: "ready", summary: "TL;DR" });
		});

		it("omits readerPollUrl when the crawl has failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", reason: "blocked" },
				summary: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.readerPollUrl).toBeUndefined();
			expect(result.crawl).toEqual({ status: "failed", reason: "blocked" });
		});

		it("does NOT re-prime a legacy stub from the reader path (auto-heal removed; recovery is operator-driven via /admin/recrawl)", async () => {
			const { state, deps } = initFakeDeps({
				crawl: undefined,
				summary: undefined,
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(state.markCrawlPendingCalls).toBe(0);
			expect(state.markSummaryPendingCalls).toBe(0);
			// crawl + summary stay undefined; the read-after-write race branch in
			// shouldKeepPollingReader still emits a poll URL so the page keeps
			// asking while the stale-check Lambda decides what to do.
			expect(result.crawl).toBeUndefined();
			expect(result.summary).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
			expect(result.summaryPollUrl).toBe("/test/summary?poll=1");
		});

		it("does not re-prime when crawl is present but summary is missing", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: undefined,
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(state.markCrawlPendingCalls).toBe(0);
			expect(state.markSummaryPendingCalls).toBe(0);
		});

		it("does not re-prime when summary is present but crawl is missing", async () => {
			const { state, deps } = initFakeDeps({
				crawl: undefined,
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			await reader.resolveReaderState({
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(state.markCrawlPendingCalls).toBe(0);
			expect(state.markSummaryPendingCalls).toBe(0);
		});

		it("emits readerPollUrl when crawl is undefined with no content (read-after-write race)", async () => {
			const { deps } = initFakeDeps({
				crawl: undefined,
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const result = await reader.resolveReaderState({
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
				article: makeSnapshot(),
				pollUrlBuilder: makePollUrlBuilder(),
			});

			expect(result.crawl).toEqual({ status: "ready" });
			expect(result.content).toBeUndefined();
			expect(result.readerPollUrl).toBe("/test/reader?poll=1");
		});
	});

	describe("handleSummaryPoll", () => {
		it("emits a polling slot with the next poll URL when summary is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 3,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/summary?poll=4");
		});

		it("stops polling at MAX_POLLS", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("includes the unified progress bar as an hx-swap-oob fragment so the bar updates without a separate poll", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const bar = doc.querySelector("#article-body-progress");
			assert(bar, "progress bar OOB element must accompany the slot fragment");
			expect(bar.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(bar.getAttribute("data-progress-stage")).toBe("summary-generating");
			expect(bar.getAttribute("data-progress-pct")).toBe("90");
		});

		it("renders a ready summary expanded (summaryOpen: true) and stops polling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			const details = doc.querySelector(".article-body__summary");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(true);
		});

		it("collapses the summary slot when the crawl has failed (no further polling)", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", reason: "blocked" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("handleReaderPoll", () => {
		it("emits the reader slot with the next poll URL when crawl is pending", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 2,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=3");
		});

		it("stops polling at MAX_POLLS=40 and swaps to the 'Your link is saved' slow reframe", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
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

		it("includes the unified progress bar as an hx-swap-oob fragment driven by the recorded crawl stage", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", stage: "crawl-content-uploaded" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const bar = doc.querySelector("#article-body-progress");
			assert(bar, "progress bar OOB element must accompany the slot fragment");
			expect(bar.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(bar.getAttribute("data-progress-stage")).toBe("crawl-content-uploaded");
			expect(bar.getAttribute("data-progress-pct")).toBe("53");
		});

		it("renders the ready reader with content when the crawl is ready", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: "<article><p>Body</p></article>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 5,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 5,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: MAX_POLLS,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("renders the reader as failed when the crawl has failed", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "failed", reason: "blocked" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("failed");
		});

		it("includes the article header as an hx-swap-oob fragment carrying the latest title so the H1 settles in place once the crawl writes it over the hostname stub", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const header = doc.querySelector("#article-header");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(header.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Why Rust beats Go",
			);
		});

		it("includes a <title> hx-swap-oob fragment formatted via deps.formatDocumentTitle so the browser tab updates without any client-side JS", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the reader-slot");
			expect(titleEl.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(titleEl.textContent).toBe("Why Rust beats Go — TestReader");
		});

		it("renders header + <title> with the back-link slot when initArticleReader was given a backLink — proving deps.backLink is wired into the OOB header", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader({
				...deps,
				backLink: { href: "/queue", label: "← Back to queue" },
			});

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("#article-header [data-test-back-slot]");
			assert(slot, "back slot must be rendered inside the OOB header");
			expect(slot.classList.contains("article-body__back-slot--visible")).toBe(true);
			const link = slot.querySelector("[data-test-back-link]");
			assert(link, "back link must be present");
			expect(link.getAttribute("href")).toBe("/queue");
		});

		it("renders header with the mark-read slot when initArticleReader was given a markReadAction — proving deps.markReadAction is wired into the OOB header", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
			});
			const reader = initArticleReader({
				...deps,
				markReadAction: (articleId) => ({
					postUrl: `/queue/${articleId}/status?utm_content=mark-read-top`,
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				}),
			});

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("#article-header [data-test-mark-read-slot]");
			assert(slot, "mark-read slot must be rendered inside the OOB header");
			expect(slot.classList.contains("article-body__mark-read-slot--visible")).toBe(true);
			const form = slot.querySelector("[data-test-mark-read-form]");
			assert(form, "mark-read form must be present");
			const expectedId = ReaderArticleHashId.from(ARTICLE_URL).value;
			expect(form.getAttribute("action")).toBe(`/queue/${expectedId}/status?utm_content=mark-read-top`);
		});

		it("omits the header + <title> OOB fragments when the row has gone missing — falling back to swapping only the slot so the existing header text stays put", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				content: undefined,
				article: null,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			expect(doc.querySelector("#article-header")).toBeNull();
			expect(doc.querySelector("title#document-title")).toBeNull();
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader-slot fragment must still be emitted even with no article row");
		});
	});

	describe("handleSummaryPoll header + title OOB", () => {
		it("renders the mark-read slot in the OOB header via the summary-poll path when deps.markReadAction is provided", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
			});
			const reader = initArticleReader({
				...deps,
				markReadAction: (articleId) => ({
					postUrl: `/queue/${articleId}/status?utm_content=mark-read-top`,
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				}),
			});

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("#article-header [data-test-mark-read-slot]");
			assert(slot, "mark-read slot must be rendered inside the OOB header");
			expect(slot.classList.contains("article-body__mark-read-slot--visible")).toBe(true);
		});

		it("emits the header and <title> OOB fragments alongside the summary-slot so a settled title can land via the summary-poll path too (whichever poll fires first wins)", async () => {
			const { state, deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "pending", stage: "summary-generating" },
			});
			state.article = {
				...defaultFakeArticle(),
				metadata: {
					title: "Why Rust beats Go",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
			};
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const header = doc.querySelector("#article-header");
			assert(header, "header OOB fragment must accompany the summary-slot");
			expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(header.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Why Rust beats Go",
			);
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the summary-slot");
			expect(titleEl.textContent).toBe("Why Rust beats Go — TestReader");
		});
	});

	/* The progress bar tracks BOTH crawl and summary, but each slot has its
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "OOB summary slot must accompany the reader-poll response");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(summarySlot.getAttribute("hx-get")).toBe("/test/summary?poll=1");
		});

		it("handleSummaryPoll emits an OOB reader slot with hx-get when crawl has gone pending while summary is settling", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending", stage: "crawl-fetching" },
				summary: { status: "ready", summary: "TL;DR" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "OOB summary slot must accompany the reader-poll response");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("ready");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
		});

		it("handleSummaryPoll emits a terminal OOB reader slot (no hx-get) when crawl is ready and content is present", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				summary: { status: "ready", summary: "TL;DR" },
				content: "<p>body</p>",
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 1,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "OOB reader slot must accompany the summary-poll response");
			expect(readerSlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(readerSlot.getAttribute("data-reader-status")).toBe("ready");
			expect(readerSlot.hasAttribute("hx-get")).toBe(false);
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

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 0,
				pollUrlBuilder: makePollUrlBuilder(),
				extensionInstallUrl: undefined,
			});

			const doc = parse(toHtml(component));
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "reader slot present");
			expect(readerSlot.hasAttribute("hx-get")).toBe(false);
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be present as an OOB swap to keep the chain alive");
			expect(summarySlot.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(summarySlot.getAttribute("hx-get")).toBe("/test/summary?poll=1");
			const bar = doc.querySelector("#article-body-progress");
			assert(bar, "progress bar still present");
			expect(bar.getAttribute("hx-swap-oob")).toBe("outerHTML");
		});
	});
});
