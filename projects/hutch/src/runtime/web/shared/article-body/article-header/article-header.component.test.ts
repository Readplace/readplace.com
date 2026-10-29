import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { destinationUrl, siteLabel } from "../../../test-helpers/article-fixtures";
import {
	renderArticleHeader,
	renderArticleHeaderOob,
	renderDocumentTitleOob,
} from "./article-header.component";

const baseInput = {
	title: "Hello World",
	siteName: siteLabel("example.com"),
	readTime: { value: "3", label: "3 min read" },
	url: destinationUrl("https://example.com/post"),
	provenance: undefined,
	readlistTags: undefined,
	saved: undefined,
	publishedOn: undefined,
};

const SIX_HOURS_AGO = { iso: "2026-04-25T06:00:00.000Z", label: "6h ago", mode: "relative" } as const;

const WORK_READLIST = {
	unassignUrl: "/queue/abc123/unassign",
	returnTo: "/queue/abc123/view",
	tags: [{ slug: ReadlistSlugSchema.parse("work"), label: "Work" }],
};

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function facts(doc: Document): [string | null, string][] {
	return Array.from(doc.querySelectorAll("[data-test-reader-fact]"), (fact): [string | null, string] => [
		fact.getAttribute("data-test-reader-fact"),
		fact.textContent?.trim() ?? "",
	]);
}

function provenanceFallback(doc: Document): Element {
	const fallback = doc.querySelector("[data-test-reader-provenance-fallback]");
	assert(fallback, "the plain provenance fact a browser without popovers shows must render");
	return fallback;
}

function metaRow(doc: Document): string[] {
	const meta = doc.querySelector(".article-body__meta");
	assert(meta, "the meta row must render");
	return Array.from(meta.children, (child) => child.className);
}

function tagRow(doc: Document): (string | null)[] {
	const row = doc.querySelector("[data-test-reader-tags]");
	assert(row, "the tag row must render");
	return Array.from(row.querySelectorAll(":scope > li > .chip"), (chip) => chip.getAttribute("data-test-readlist-tag"));
}

function headerRows(doc: Document): string[] {
	const header = doc.querySelector("#article-header");
	assert(header, "header must render");
	return Array.from(header.children, (child) => child.className);
}

describe("renderArticleHeader (inline)", () => {
	it("uses the stable id so OOB poll responses can swap it without coordinating with the rest of the article body", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "header must carry the stable id");
		expect(header.classList.contains("article-body__header")).toBe(true);
		expect(header.hasAttribute("hx-swap-oob")).toBe(false);
	});

	it("renders the title over a meta row of site, read time and the Original link for an article no reader owns", () => {
		const doc = parse(renderArticleHeader(baseInput));

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Hello World");
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe("example.com");
		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["read-time", "3 min read"],
			["original", "Original article"],
		]);
	});

	it("opens Original on the article's own page in a new tab", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const originalLink = doc.querySelector("[data-test-original-link]");
		assert(originalLink, "the Original link must be rendered");
		expect(originalLink.getAttribute("href")).toBe("https://example.com/post");
		expect(originalLink.getAttribute("target")).toBe("_blank");
		expect(originalLink.getAttribute("rel")).toBe("noopener");
		expect(originalLink.getAttribute("data-test-reader-fact")).toBe("original");
	});

	it("orders an owner's facts site, saved, read time, provenance, then Original", () => {
		const doc = parse(
			renderArticleHeader({ ...baseInput, saved: SIX_HOURS_AGO, provenance: { kind: "web" } }),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["saved", "Saved 6h ago"],
			["read-time", "3 min read"],
			["provenance", "via Web"],
			["original", "Original article"],
		]);
	});

	it("orders an owner's facts site, published, saved, read time, provenance, then Original when the source states a publish date", () => {
		const doc = parse(
			renderArticleHeader({ ...baseInput, publishedOn: "2025-10-08", saved: SIX_HOURS_AGO, provenance: { kind: "web" } }),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["published", "Published Oct 8, 2025"],
			["saved", "Saved 6h ago"],
			["read-time", "3 min read"],
			["provenance", "via Web"],
			["original", "Original article"],
		]);
	});

	it("names the publish date as an absolute calendar date the local-time script leaves alone", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, publishedOn: "2025-10-08" }));

		const fact = doc.querySelector('[data-test-reader-fact="published"]');
		assert(fact, "the published fact must render");
		expect(fact.classList.contains("article-body__published")).toBe(true);
		const published = doc.querySelector("[data-test-reader-published]");
		assert(published, "the publish date must render");
		expect(published.tagName.toLowerCase()).toBe("time");
		expect([published.getAttribute("datetime"), published.getAttribute("data-local-time"), published.textContent]).toEqual([
			"2025-10-08",
			null,
			"Oct 8, 2025",
		]);
	});

	it("labels a save older than the relative window with its date", () => {
		const doc = parse(
			renderArticleHeader({ ...baseInput, saved: { iso: "2025-09-08T00:00:00.000Z", label: "Sep 8, 2025", mode: "date" } }),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["saved", "Saved Sep 8, 2025"],
			["read-time", "3 min read"],
			["original", "Original article"],
		]);
	});

	it("names when the reader saved the article as a time the local-time script can refine", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, saved: SIX_HOURS_AGO }));

		const saved = doc.querySelector("[data-test-reader-saved]");
		assert(saved, "the saved time must render");
		expect(saved.tagName.toLowerCase()).toBe("time");
		expect(saved.getAttribute("datetime")).toBe("2026-04-25T06:00:00.000Z");
		expect(saved.getAttribute("data-local-time")).toBe("relative");
		expect(saved.textContent).toBe("6h ago");
	});

	it("no longer renders the top action bar inside the header (it moved to reader-actions)", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "header must render");
		expect(header.querySelector(".article-body__actions--top")).toBe(null);
	});
});

describe("read time", () => {
	it("renders the server's label verbatim once the crawl has counted the words", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const readTime = doc.querySelector("[data-test-reader-read-time]");
		assert(readTime, "the read-time span must render");
		expect(readTime.textContent).toBe("3 min read");
		expect(readTime.classList.contains("article-body__read-time--empty")).toBe(false);
	});

	it("keeps the span but marks it empty while the crawl has not landed, so the OOB swap has a node to replace", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, readTime: undefined }));

		const readTime = doc.querySelector("[data-test-reader-read-time]");
		assert(readTime, "the read-time span must still render so the OOB swap can fill it");
		expect(readTime.classList.contains("article-body__read-time--empty")).toBe(true);
		expect(readTime.textContent).toBe("");
	});
});

describe("tag row", () => {
	it("lists the readlists holding the article, in order, between the title and the facts", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				readlistTags: {
					...WORK_READLIST,
					tags: [...WORK_READLIST.tags, { slug: ReadlistSlugSchema.parse("later"), label: "Later" }],
				},
			}),
		);

		expect(tagRow(doc)).toEqual(["work", "later"]);
		expect(headerRows(doc)).toEqual(["article-body__title", "article-body__tags", "article-body__meta"]);
	});

	it("renders a removable chip per readlist holding the article", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, readlistTags: WORK_READLIST }));

		const tag = doc.querySelector('[data-test-readlist-tag="work"]');
		assert(tag, "the readlist tag must render in the tag row");
		expect(tag.textContent).toContain("Work");
		const form = tag.querySelector("form");
		assert(form, "the tag must carry its un-assign form");
		expect(form.getAttribute("action")).toBe("/queue/abc123/unassign");
		expect(form.querySelector('input[name="queue"]')?.getAttribute("value")).toBe("work");
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			"/queue/abc123/view",
		);
		const remove = form.querySelector('[data-test-unassign-readlist="work"]');
		assert(remove, "the tag must carry its remove button");
	});

	it("renders no tag row for an article that lives only in the default readlist", () => {
		const doc = parse(renderArticleHeader(baseInput));

		const tags = Array.from(doc.querySelectorAll("[data-test-readlist-tag]"), (el) =>
			el.getAttribute("data-test-readlist-tag"),
		);
		expect(tags).toEqual([]);
		expect(headerRows(doc)).toEqual(["article-body__title", "article-body__meta"]);
	});
});

describe("save provenance tag", () => {
	it("shows no provenance fact for an article saved before provenance was captured", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, saved: SIX_HOURS_AGO }));

		expect(facts(doc).map(([key]) => key)).toEqual(["site", "saved", "read-time", "original"]);
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

	it("names the sender an emailed save arrived from, next to the envelope", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				provenance: { kind: "email", senderEmail: "news@example.com" },
			}),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["read-time", "3 min read"],
			["provenance", "via news@example.com"],
			["original", "Original article"],
		]);
		const envelope = parse(iconSvg("envelope")).querySelector("svg");
		assert(envelope, "the envelope must parse as an svg");
		expect(doc.querySelector("[data-test-reader-provenance] svg")?.outerHTML).toBe(envelope.outerHTML);
	});

	it("names the newsletter a catalogued sender publishes, keeping the address on hover, behind a tap, and on the plain fact a browser without popovers shows", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				provenance: { kind: "newsletter", name: "TLDR", senderEmail: "dan@tldr.tech" },
			}),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["read-time", "3 min read"],
			["provenance", "via TLDR"],
			["original", "Original article"],
		]);
		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.tagName.toLowerCase()).toBe("button");
		expect(tag.getAttribute("type")).toBe("button");
		expect(tag.getAttribute("title")).toBe("dan@tldr.tech");
		expect(tag.getAttribute("popovertarget")).toBe("article-provenance-sender");
		expect(tag.classList.contains("sender-popover__trigger")).toBe(true);
		const fallback = provenanceFallback(doc);
		expect(fallback.tagName.toLowerCase()).toBe("span");
		expect(fallback.getAttribute("title")).toBe("dan@tldr.tech");
		expect(fallback.textContent?.trim()).toBe("via TLDR");
		const sender = doc.querySelector("#article-provenance-sender");
		assert(sender, "the sender popover must render for a named newsletter");
		expect(sender.getAttribute("popover")).toBe("auto");
		expect(sender.hasAttribute("data-test-reader-provenance-sender")).toBe(true);
		expect(Array.from(sender.children, (line) => [line.className, line.textContent])).toEqual([
			["sender-popover__name", "TLDR"],
			["sender-popover__address", "dan@tldr.tech"],
		]);
		expect(metaRow(doc)).toEqual([
			"article-body__fact article-body__site",
			"article-body__fact article-body__read-time",
			"article-body__fact article-body__provenance sender-popover__fallback",
			"article-body__fact article-body__provenance sender-popover__trigger",
			"sender-popover",
			"article-body__fact article-body__original",
		]);
	});

	it("keeps an uncatalogued sender's fact a plain span alone, whose title repeats the address it already shows", () => {
		const doc = parse(
			renderArticleHeader({
				...baseInput,
				provenance: { kind: "email", senderEmail: "news@example.com" },
			}),
		);

		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.tagName.toLowerCase()).toBe("span");
		expect(tag.getAttribute("title")).toBe("via news@example.com");
		expect(provenanceFallback(doc).isSameNode(tag)).toBe(true);
		expect(metaRow(doc)).toEqual([
			"article-body__fact article-body__site",
			"article-body__fact article-body__read-time",
			"article-body__fact article-body__provenance",
			"article-body__fact article-body__original",
		]);
	});

	it("carries no icon for a save the web app made itself", () => {
		const doc = parse(renderArticleHeader({ ...baseInput, provenance: { kind: "web" } }));

		const tag = doc.querySelector("[data-test-reader-provenance]");
		assert(tag, "provenance tag must render");
		expect(tag.textContent).toBe("via Web");
		expect(Array.from(tag.children).map((child) => child.tagName.toLowerCase())).toEqual(["span"]);
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
		expect(Array.from(tag.children).map((child) => child.tagName.toLowerCase())).toEqual(["svg", "span"]);
	});
});

describe("renderArticleHeaderOob", () => {
	it("emits the same header markup carrying hx-swap-oob so it slots into poll responses alongside the existing reader-slot", () => {
		const doc = parse(renderArticleHeaderOob(baseInput));

		const header = doc.querySelector("#article-header");
		assert(header, "OOB header must be rendered");
		expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Hello World");
	});

	it("keeps every fact and tag through the swap that replaces the whole header", () => {
		const doc = parse(
			renderArticleHeaderOob({
				...baseInput,
				provenance: { kind: "web" },
				saved: SIX_HOURS_AGO,
				publishedOn: "2025-10-08",
				readlistTags: WORK_READLIST,
			}),
		);

		expect(facts(doc)).toEqual([
			["site", "example.com"],
			["published", "Published Oct 8, 2025"],
			["saved", "Saved 6h ago"],
			["read-time", "3 min read"],
			["provenance", "via Web"],
			["original", "Original article"],
		]);
		expect(tagRow(doc)).toEqual(["work"]);
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
