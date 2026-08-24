import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { toAbsoluteShortDateTime } from "@packages/web-shell/local-time.format";
import { renderArticleBody } from "./article-body.component";

const baseInput = {
	title: "Hello World",
	siteName: "example.com",
	estimatedReadTime: 3 as Minutes,
	url: "https://example.com/post",
	appOrigin: "https://readplace.com",
	topActionsHtml: "",
	bottomActionsHtml: "",
};

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderArticleBody", () => {
	it("passes the owner's save provenance through to the header, and leaves it off when the caller has none", () => {
		const tagOf = (html: string) =>
			parse(html).querySelector("[data-test-reader-provenance]")?.textContent?.trim();

		expect([
			tagOf(renderArticleBody({ ...baseInput, provenance: { kind: "import" } })),
			tagOf(renderArticleBody(baseInput)),
		]).toEqual(["via Import", undefined]);
	});

	it("renders the article title, site name, reading time and content", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body copy</p>",
		});
		const doc = parse(html);

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
			"Hello World",
		);
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe(
			"example.com",
		);
		expect(doc.querySelector(".article-body__meta")?.textContent).toContain(
			"3 min read",
		);
		const content = doc.querySelector("[data-test-reader-content]");
		assert(content, "reader content must be rendered");
		expect(content.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("delegates to the summary slot renderer", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			summary: { status: "ready", summary: "Key points." },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered inside the article body");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
	});

	it("defers the summary slot (no 'Generating summary') while the crawl is still pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "pending" },
			summary: { status: "pending" },
			summaryPollUrl: "/queue/abc/summary?poll=1",
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.classList.contains("article-body__summary-slot--hidden")).toBe(
			true,
		);
		expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
	});

	it("shows 'Generating summary' once the reader view is ready and the summary is still pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			crawl: { status: "ready" },
			summary: { status: "pending" },
			summaryPollUrl: "/queue/abc/summary?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(
			doc.querySelector(".article-body__summary-loading")?.textContent,
		).toBe("Generating summary");
	});

	it("splices the injected action bars above the header and below the reader slot", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			topActionsHtml: '<div data-test-top-actions>top</div>',
			bottomActionsHtml: '<div data-test-bottom-actions>bottom</div>',
		});
		const doc = parse(html);

		assert(doc.querySelector("[data-test-top-actions]"), "top actions must be spliced in");
		assert(doc.querySelector("[data-test-bottom-actions]"), "bottom actions must be spliced in");
		expect(html.indexOf("data-test-top-actions")).toBeLessThan(html.indexOf('id="article-header"'));
		expect(html.indexOf("data-test-bottom-actions")).toBeGreaterThan(html.indexOf("data-test-reader-content"));
	});

	it("renders the reader-pending slot when content is undefined and no crawl status is provided (read-after-write race)", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
	});

	it("renders the reader-pending slot with poll attributes when crawl is pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "pending" },
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
	});

	it("renders the crawl bookmark tabs when versions are supplied", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			crawlVersions: [
				toAbsoluteShortDateTime({ iso: "2026-07-10T09:14Z" }),
				toAbsoluteShortDateTime({ iso: "2026-06-28T22:01Z" }),
			],
		});
		const doc = parse(html);

		const keys = Array.from(doc.querySelectorAll("[data-test-crawl-bookmark-tab]")).map((el) =>
			el.getAttribute("data-test-crawl-bookmark-tab"),
		);
		expect(keys).toEqual(["canonical", "2026-06-28T22:01Z"]);
	});

	it("omits the crawl bookmark when no versions are supplied", () => {
		const html = renderArticleBody({ ...baseInput, content: "<p>Body</p>" });
		const doc = parse(html);
		expect(doc.querySelectorAll("[data-test-crawl-bookmark-tab]").length).toBe(0);
	});

	it("renders the reader-failed slot when crawl status is failed", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		const link = slot.querySelector(".article-body__reader-notice-link");
		expect(link?.getAttribute("href")).toBe("https://example.com/post");
	});

});
