import assert from "node:assert/strict";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { JSDOM } from "jsdom";
import { renderSummaryReady } from "./summary-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

const LONG_SUMMARY =
	"The article walks through the reasoning step by step, covering the setup, the core argument, the counterexamples, and finally a synthesis that ties every strand together into one conclusion.";

describe("renderSummaryReady", () => {
	it("renders a visible slot with status=ready and the summary text", () => {
		const doc = parse(renderSummaryReady({ summary: "Key points.", open: false }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		expect(doc.querySelector(".article-body__summary-heading")?.textContent).toBe(
			"Summary (TL;DR)",
		);
		expect(doc.querySelector(".article-body__summary-text")?.textContent).toBe(
			"Key points.",
		);
	});

	it("renders collapsed by default", () => {
		const doc = parse(renderSummaryReady({ summary: "Key points.", open: false }));

		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(false);
	});

	it("renders expanded when open=true", () => {
		const doc = parse(renderSummaryReady({ summary: "Key points.", open: true }));

		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(true);
	});

	it("carries data-summary-toggle-url on the <details> when a tracking URL is supplied (internal reader)", () => {
		const doc = parse(
			renderSummaryReady({ summary: "Key points.", open: false, summaryToggleUrl: "/queue/abc/summary-toggle" }),
		);

		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.getAttribute("data-summary-toggle-url")).toBe("/queue/abc/summary-toggle");
	});

	it("omits data-summary-toggle-url when no tracking URL is supplied (public / admin readers)", () => {
		const doc = parse(renderSummaryReady({ summary: "Key points.", open: true }));

		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("data-summary-toggle-url")).toBe(false);
	});

	it("HTML-escapes the summary text", () => {
		const doc = parse(
			renderSummaryReady({
				summary: "<script>alert('x')</script>",
				open: false,
			}),
		);

		const text = doc.querySelector(".article-body__summary-text");
		assert(text, "summary text must be rendered");
		expect(text.textContent).toBe("<script>alert('x')</script>");
		expect(text.innerHTML).not.toContain("<script>");
	});

	it("shows the excerpt as the collapsed preview with a view-more affordance", () => {
		const doc = parse(
			renderSummaryReady({
				summary: LONG_SUMMARY,
				excerpt: "A one-sentence teaser of the piece.",
				open: false,
			}),
		);

		const preview = doc.querySelector(".article-body__summary-preview");
		assert(preview, "preview must be rendered");
		expect(preview.textContent).toBe("A one-sentence teaser of the piece. … view more");
		expect(doc.querySelector(".article-body__summary-more")?.textContent).toBe("… view more");
	});

	it("renders a stored excerpt whole, even one longer than the fallback's budget", () => {
		const overBudget =
			"A teaser written when the excerpt budget was wider, long enough that the fallback's word-boundary cut would visibly shorten it.";
		assert(
			overBudget.length > MAX_EXCERPT_LENGTH,
			"the excerpt must exceed the fallback budget or this proves nothing",
		);

		const doc = parse(
			renderSummaryReady({ summary: LONG_SUMMARY, excerpt: overBudget, open: false }),
		);

		expect(doc.querySelector(".article-body__summary-preview")?.textContent).toBe(
			`${overBudget} … view more`,
		);
	});

	it("keeps the preview inside the <summary> so it shows while the <details> is closed", () => {
		const doc = parse(
			renderSummaryReady({ summary: LONG_SUMMARY, excerpt: "Teaser.", open: false }),
		);

		const preview = doc.querySelector(".article-body__summary-preview");
		assert(preview, "preview must be rendered");
		assert(preview.closest("summary"), "preview must live inside the <summary>");
	});

	it("marks the preview aria-hidden so it does not pollute the disclosure's accessible name", () => {
		const doc = parse(
			renderSummaryReady({ summary: LONG_SUMMARY, excerpt: "Teaser.", open: false }),
		);

		expect(
			doc.querySelector(".article-body__summary-preview")?.getAttribute("aria-hidden"),
		).toBe("true");
	});

	it("falls back to a word-boundary slice of the summary when no excerpt is stored", () => {
		const doc = parse(renderSummaryReady({ summary: LONG_SUMMARY, open: false }));

		const preview = doc.querySelector(".article-body__summary-preview");
		assert(preview, "preview must be rendered");
		expect(preview.textContent?.endsWith(" … view more")).toBe(true);
		expect(preview.textContent?.startsWith("The article walks through")).toBe(true);
		// The fallback is capped well under the full summary length.
		expect((preview.textContent ?? "").length).toBeLessThan(LONG_SUMMARY.length);
	});

	it("flattens whitespace in the fallback preview while the full text keeps it", () => {
		const doc = parse(
			renderSummaryReady({ summary: "First point.\n\nSecond point.", open: false }),
		);

		expect(doc.querySelector(".article-body__summary-preview")?.textContent).toBe(
			"First point. Second point. … view more",
		);
		expect(doc.querySelector(".article-body__summary-text")?.textContent).toBe(
			"First point.\n\nSecond point.",
		);
	});

	it("strips a trailing ellipsis from the excerpt so it does not double up", () => {
		const doc = parse(
			renderSummaryReady({ summary: LONG_SUMMARY, excerpt: "Cut short…", open: false }),
		);

		expect(doc.querySelector(".article-body__summary-preview")?.textContent).toBe(
			"Cut short … view more",
		);
	});

	it("HTML-escapes the preview", () => {
		const doc = parse(
			renderSummaryReady({
				summary: LONG_SUMMARY,
				excerpt: "<script>alert('x')</script>",
				open: false,
			}),
		);

		const preview = doc.querySelector(".article-body__summary-preview");
		assert(preview, "preview must be rendered");
		expect(preview.querySelector("script")).toBe(null);
		expect(preview.textContent).toContain("<script>");
	});

	it("still renders the full summary in the <pre> when expanded", () => {
		const doc = parse(renderSummaryReady({ summary: LONG_SUMMARY, excerpt: "Teaser.", open: true }));

		expect(doc.querySelector(".article-body__summary-text")?.textContent).toBe(LONG_SUMMARY);
	});
});
