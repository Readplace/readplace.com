import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { QueueSlugSchema } from "@packages/domain/queue";
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
	provenance: undefined,
	queueTags: undefined,
};

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function metaRow(doc: Document): string[] {
	const meta = doc.querySelector(".article-body__meta");
	assert(meta, "meta row must render");
	return Array.from(meta.querySelectorAll("span")).map((span) => span.textContent?.trim() ?? "");
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

	it("no longer renders the top action bar inside the header (it moved to reader-actions)", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "header must render");
		expect(header.querySelector(".article-body__actions--top")).toBe(null);
	});
});

describe("queue tags", () => {
	it("renders a removable chip per queue holding the article", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				queueTags: {
					unassignUrl: "/queue/abc123/unassign",
					returnTo: "/queue/abc123/view",
					tags: [{ slug: QueueSlugSchema.parse("work"), label: "Work" }],
				},
			}),
		);

		const tag = doc.querySelector('[data-test-queue-tag="work"]');
		assert(tag, "the queue tag must render in the meta row");
		expect(tag.textContent).toContain("Work");
		const form = tag.querySelector("form");
		assert(form, "the tag must carry its un-assign form");
		expect(form.getAttribute("action")).toBe("/queue/abc123/unassign");
		expect(form.querySelector('input[name="queue"]')?.getAttribute("value")).toBe("work");
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			"/queue/abc123/view",
		);
		const remove = form.querySelector('[data-test-unassign-queue="work"]');
		assert(remove, "the tag must carry its remove button");
	});

	it("renders no chip for an article that lives only in the default queue", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const tags = Array.from(doc.querySelectorAll("[data-test-queue-tag]"), (el) =>
			el.getAttribute("data-test-queue-tag"),
		);
		expect(tags).toEqual([]);
	});
});

describe("save provenance tag", () => {
	it("leaves the meta row exactly as it was for an article saved before provenance was captured", () => {
		const doc = parse(renderArticleHeader(baseInput));

		expect(metaRow(doc)).toEqual(["example.com", "3 min read"]);
	});

	it("names the client a save came from and carries its logo", () => {
		const doc = parse(
			renderArticleHeader({ ...baseInput, provenance: { kind: "client", clientName: "chrome" } }),
		);

		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.textContent?.trim()).toBe("via Chrome");
		expect(tag.getAttribute("title")).toBe("via Chrome");
		expect(tag.classList.contains("article-body__provenance")).toBe(true);
		expect(tag.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
	});

	it("names the sender an emailed save arrived from, next to the mail icon", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				provenance: { kind: "email", senderEmail: "news@example.com" },
			}),
		);

		expect(metaRow(doc)).toEqual(["example.com", "3 min read", "via news@example.com"]);
		expect(
			doc.querySelector("[data-test-reader-provenance] svg")?.getAttribute("viewBox"),
		).toBe("0 0 24 24");
	});

	it("carries no icon for a save the web app made itself", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, provenance: { kind: "web" } }));

		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.textContent).toBe("via Web");
		expect(tag.children).toHaveLength(0);
	});

	it("escapes a sender address so an email cannot inject markup into the reader it is tagged in", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				provenance: { kind: "email", senderEmail: "<img src=x onerror=alert(1)>@evil.test" },
			}),
		);

		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.textContent).toBe("via <img src=x onerror=alert(1)>@evil.test");
		expect(Array.from(tag.children).map((child) => child.tagName.toLowerCase())).toEqual(["svg"]);
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

	it("keeps the provenance tag through the swap that replaces the whole header", () => {
		const doc = parse(
			renderArticleHeaderOob({ ...baseInput, provenance: { kind: "web" } }),
		);

		expect(metaRow(doc)).toEqual(["example.com", "3 min read", "via Web"]);
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
