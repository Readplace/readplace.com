import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { GlobalArticleData } from "@packages/test-fixtures/providers/article-store";
import { initArticleReader } from "./article-reader";
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
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/summary?poll=4");
		});

		it("stops polling at MAX_POLLS=40", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
				summary: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleSummaryPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 40,
				pollUrlBuilder: makePollUrlBuilder(),
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
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=3");
		});

		it("stops polling at MAX_POLLS=40", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "pending" },
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 40,
				pollUrlBuilder: makePollUrlBuilder(),
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.hasAttribute("hx-get")).toBe(false);
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
			});

			const slot = parse(toHtml(component)).querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe("/test/reader?poll=6");
		});

		it("stops at MAX_POLLS=40 even when stuck in the promotion race", async () => {
			const { deps } = initFakeDeps({
				crawl: { status: "ready" },
				content: undefined,
			});
			const reader = initArticleReader(deps);

			const component = await reader.handleReaderPoll({
				articleUrl: ARTICLE_URL,
				pollCount: 40,
				pollUrlBuilder: makePollUrlBuilder(),
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
			});

			const doc = parse(toHtml(component));
			const slot = doc.querySelector("#article-header [data-test-back-slot]");
			assert(slot, "back slot must be rendered inside the OOB header");
			expect(slot.classList.contains("article-body__back-slot--visible")).toBe(true);
			const link = slot.querySelector("[data-test-back-link]");
			assert(link, "back link must be present");
			expect(link.getAttribute("href")).toBe("/queue");
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
			});

			const doc = parse(toHtml(component));
			expect(doc.querySelector("#article-header")).toBeNull();
			expect(doc.querySelector("title#document-title")).toBeNull();
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader-slot fragment must still be emitted even with no article row");
		});
	});

	describe("handleSummaryPoll header + title OOB", () => {
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
});
