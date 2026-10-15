import assert from "node:assert/strict";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { parseHTML } from "linkedom";
import { htmlText, plainText } from "../../trusted-text";
import { TLDR_DISCLOSURE_STYLES, renderTldrDisclosure } from "./tldr-disclosure.component";

function parse(html: string): Document {
	return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

function disclosure(doc: Document): Element {
	const details = doc.querySelector("[data-test-tldr]");
	assert(details, "the disclosure must be rendered");
	return details;
}

const LONG_SUMMARY =
	"The article walks through the reasoning step by step, covering the setup, the core argument, the counterexamples, and finally a synthesis that ties every strand together into one conclusion.";

describe("renderTldrDisclosure", () => {
	it("renders a <details> with the heading and the text body", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText("Key points.") }, open: false }));

		const details = disclosure(doc);
		expect(details.tagName.toLowerCase()).toBe("details");
		expect(details.classList.contains("tldr-disclosure")).toBe(true);
		expect(doc.querySelector(".tldr-disclosure__heading")?.textContent).toBe("Summary");
		expect(doc.querySelector(".tldr-disclosure__caret svg")).not.toBe(null);
		expect(doc.querySelector(".tldr-disclosure__text")?.textContent).toBe("Key points.");
	});

	it("leads the heading with a decorative sparkles mark", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText("Key points.") }, open: false }));

		const icon = doc.querySelector(".tldr-disclosure__heading .tldr-disclosure__icon");
		assert(icon, "the heading's icon box must be rendered");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.querySelectorAll("svg").length).toBe(1);
	});

	it("renders collapsed when open=false", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText("Key points.") }, open: false }));

		expect(disclosure(doc).hasAttribute("open")).toBe(false);
	});

	it("renders expanded when open=true", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText("Key points.") }, open: true }));

		expect(disclosure(doc).hasAttribute("open")).toBe(true);
	});

	it("carries data-summary-toggle-url when a toggle URL is supplied", () => {
		const doc = parse(
			renderTldrDisclosure({
				body: { text: plainText("Key points.") },
				open: false,
				toggleUrl: "/queue/abc/summary-toggle",
			}),
		);

		expect(disclosure(doc).getAttribute("data-summary-toggle-url")).toBe("/queue/abc/summary-toggle");
	});

	it("omits data-summary-toggle-url when no toggle URL is supplied", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText("Key points.") }, open: true }));

		expect(disclosure(doc).hasAttribute("data-summary-toggle-url")).toBe(false);
	});

	it("HTML-escapes a text body inside the <pre>", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText("<script>alert('x')</script>") }, open: false }),
		);

		const text = doc.querySelector(".tldr-disclosure__text");
		assert(text, "the text body must be rendered");
		expect(text.tagName.toLowerCase()).toBe("pre");
		expect(text.textContent).toBe("<script>alert('x')</script>");
		expect(text.innerHTML).not.toContain("<script>");
		expect(doc.querySelector(".tldr-disclosure__body")).toBe(null);
	});

	it("inserts an html body unescaped", () => {
		const doc = parse(
			renderTldrDisclosure({
				body: { html: htmlText('Read <code>this</code> and <a href="/blog/x">that</a>.') },
				excerpt: "Teaser.",
				open: false,
			}),
		);

		const body = doc.querySelector(".tldr-disclosure__body");
		assert(body, "the html body must be rendered");
		expect(body.tagName.toLowerCase()).toBe("div");
		expect(body.innerHTML).toBe('Read <code>this</code> and <a href="/blog/x">that</a>.');
		expect(doc.querySelector(".tldr-disclosure__text")).toBe(null);
	});

	it("refuses an html body that comes without an excerpt", () => {
		expect(() => renderTldrDisclosure({ body: { html: htmlText("<b>a</b>") }, open: false })).toThrow(
			"an html TL;DR body needs an excerpt",
		);
	});

	it("shows the excerpt as the collapsed preview with a view-more affordance", () => {
		const doc = parse(
			renderTldrDisclosure({
				body: { text: plainText(LONG_SUMMARY) },
				excerpt: "A one-sentence teaser of the piece.",
				open: false,
			}),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.textContent).toBe(
			"A one-sentence teaser of the piece. view more …",
		);
		expect(doc.querySelector(".tldr-disclosure__more")?.textContent).toBe("view more …");
	});

	it("keeps the view-more affordance inside the <summary> so a tap toggles rather than navigates", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, excerpt: "Teaser.", open: false }),
		);

		const more = doc.querySelector(".tldr-disclosure__more");
		assert(more, "the view-more affordance must be rendered");
		expect(more.tagName.toLowerCase()).toBe("span");
		assert(more.closest("summary"), "the view-more affordance must live inside the <summary>");
	});

	it("renders an excerpt whole, even one longer than the fallback's budget", () => {
		const overBudget =
			"A teaser written when the excerpt budget was wider, long enough that the fallback's word-boundary cut would visibly shorten it.";
		assert(
			overBudget.length > MAX_EXCERPT_LENGTH,
			"the excerpt must exceed the fallback budget or this proves nothing",
		);

		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, excerpt: overBudget, open: false }),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.textContent).toBe(`${overBudget} view more …`);
	});

	it("keeps the preview inside the <summary> so it shows while the <details> is closed", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, excerpt: "Teaser.", open: false }),
		);

		const preview = doc.querySelector(".tldr-disclosure__preview");
		assert(preview, "preview must be rendered");
		assert(preview.closest("summary"), "preview must live inside the <summary>");
	});

	it("marks the preview aria-hidden so it does not pollute the disclosure's accessible name", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, excerpt: "Teaser.", open: false }),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("falls back to a word-boundary slice of a text body when no excerpt is given", () => {
		const doc = parse(renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, open: false }));

		const preview = doc.querySelector(".tldr-disclosure__preview")?.textContent;
		assert(preview, "preview must be rendered");
		expect(preview.endsWith(" view more …")).toBe(true);
		expect(preview.startsWith("The article walks through")).toBe(true);
		expect(preview.length).toBeLessThan(LONG_SUMMARY.length);
	});

	it("flattens whitespace in the fallback preview while the body keeps it", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText("First point.\n\nSecond point.") }, open: false }),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.textContent).toBe(
			"First point. Second point. view more …",
		);
		expect(doc.querySelector(".tldr-disclosure__text")?.textContent).toBe("First point.\n\nSecond point.");
	});

	it("strips a trailing ellipsis from the excerpt so it does not double up", () => {
		const doc = parse(
			renderTldrDisclosure({ body: { text: plainText(LONG_SUMMARY) }, excerpt: "Cut short…", open: false }),
		);

		expect(doc.querySelector(".tldr-disclosure__preview")?.textContent).toBe("Cut short view more …");
	});

	it("HTML-escapes the preview", () => {
		const doc = parse(
			renderTldrDisclosure({
				body: { text: plainText(LONG_SUMMARY) },
				excerpt: "<script>alert('x')</script>",
				open: false,
			}),
		);

		const preview = doc.querySelector(".tldr-disclosure__preview");
		assert(preview, "preview must be rendered");
		expect(preview.querySelector("script")).toBe(null);
		expect(preview.textContent).toContain("<script>");
	});
});

describe("TLDR_DISCLOSURE_STYLES", () => {
	it("declares every class the templates render", () => {
		for (const name of ["", "__toggle", "__heading", "__icon", "__caret", "__preview", "__more", "__text", "__body", "__body code", "__body a"]) {
			expect(TLDR_DISCLOSURE_STYLES).toContain(`.tldr-disclosure${name} {`);
		}
		expect(TLDR_DISCLOSURE_STYLES).toMatch(/\.tldr-disclosure\[open\] \.tldr-disclosure__preview\s*\{\s*display:\s*none;/);
		expect(TLDR_DISCLOSURE_STYLES).toContain("prefers-reduced-motion: reduce");
	});
});
