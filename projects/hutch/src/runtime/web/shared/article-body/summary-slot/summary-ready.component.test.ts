import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummaryReady } from "./summary-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderSummaryReady", () => {
	it("renders a visible slot with status=ready and the summary text", () => {
		const doc = parse(renderSummaryReady({ summary: "Key points.", open: false }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		expect(doc.querySelector(".article-body__summary-toggle")?.textContent).toBe(
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
});
