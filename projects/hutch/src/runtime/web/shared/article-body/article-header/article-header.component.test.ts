import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import {
	renderArticleHeader,
	renderArticleHeaderOob,
	renderDocumentTitleOob,
} from "./article-header.component";

const baseInput = {
	title: "Hello World",
	siteName: "example.com",
	estimatedReadTime: 3 as Minutes,
	url: "https://example.com/post",
};

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("renderArticleHeader (inline)", () => {
	it("uses the stable id so OOB poll responses can swap it without coordinating with the rest of the article body", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "header must carry the stable id");
		expect(header.classList.contains("article-body__header")).toBe(true);
		expect(header.hasAttribute("hx-swap-oob")).toBe(false);
	});

	it("renders the title, site name, read time and original-link href so the inline form looks identical to the legacy markup", () => {
		const doc = parse(renderArticleHeader(baseInput));

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Hello World");
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe("example.com");
		expect(doc.querySelector(".article-body__meta")?.textContent).toContain("3 min read");
		const originalLink = doc.querySelector("[data-test-original-link]");
		assert(originalLink, "view-original link must be rendered");
		expect(originalLink.getAttribute("href")).toBe("https://example.com/post");
	});

	it("renders the back-slot in its visible state when backLink is provided", () => {
		const doc = parse(renderArticleHeader({
			...baseInput,
			backLink: { href: "/queue", label: "← Back to queue" },
		}));

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered");
		expect(slot.classList.contains("article-body__back-slot--visible")).toBe(true);
		const link = slot.querySelector("[data-test-back-link]");
		assert(link, "back link must be rendered when backLink is provided");
		expect(link.getAttribute("href")).toBe("/queue");
		expect(link.textContent).toBe("← Back to queue");
	});

	it("renders the back-slot hidden (rather than absent) when backLink is omitted, so the visible/hidden swap is a class toggle and not a tree mutation", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must always be present");
		expect(slot.classList.contains("article-body__back-slot--hidden")).toBe(true);
	});
});

describe("renderArticleHeaderOob", () => {
	it("emits the same header markup carrying hx-swap-oob so it slots into poll responses alongside the existing reader-slot and progress-bar OOB", () => {
		const doc = parse(renderArticleHeaderOob(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "OOB header must be rendered");
		expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Hello World");
	});

	it("preserves the back-slot visibility class in the OOB form so a poll-driven header swap on /queue/:id/read does not erase the back-link styling", () => {
		const doc = parse(renderArticleHeaderOob({
			...baseInput,
			backLink: { href: "/queue", label: "← Back to queue" },
		}));

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered in the OOB form");
		expect(slot.classList.contains("article-body__back-slot--visible")).toBe(true);
	});
});

describe("renderDocumentTitleOob", () => {
	it("emits a <title> tag carrying the stable id so htmx can match it against the live <title id=\"document-title\"> in the page <head>", () => {
		const html = renderDocumentTitleOob("Hello World — Readplace Reader");

		expect(html).toBe(
			'<title id="document-title" hx-swap-oob="outerHTML">Hello World — Readplace Reader</title>',
		);
	});

	it("HTML-escapes characters inside the title so a saved article whose title contains < or & cannot break out of the <title> tag", () => {
		const html = renderDocumentTitleOob("<script>alert(1)</script> & friends");

		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; friends");
		expect(html).not.toContain("<script>");
	});
});
