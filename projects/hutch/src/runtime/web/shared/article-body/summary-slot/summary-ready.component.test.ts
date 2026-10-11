import assert from "node:assert/strict";
import { plainText, renderTldrDisclosure } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { renderSummaryReady } from "./summary-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function slotOf(html: string): Element {
	const slot = parse(html).querySelector("[data-test-reader-summary]");
	assert(slot, "summary slot must be rendered");
	return slot;
}

describe("renderSummaryReady", () => {
	it("renders a visible slot with status=ready", () => {
		const slot = slotOf(renderSummaryReady({ summary: "Key points.", open: false }));

		expect(slot.id).toBe("article-body-summary-slot");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(true);
	});

	it("swaps out-of-band only when asked to", () => {
		expect(
			slotOf(renderSummaryReady({ summary: "Key points.", open: false, oob: true })).getAttribute("hx-swap-oob"),
		).toBe("outerHTML");
		expect(
			slotOf(renderSummaryReady({ summary: "Key points.", open: false })).hasAttribute("hx-swap-oob"),
		).toBe(false);
	});

	it("fills the slot with the shared TL;DR disclosure built from its input", () => {
		const html = renderSummaryReady({
			summary: "<b>Key</b> points.",
			excerpt: "Teaser.",
			open: true,
			summaryToggleUrl: "/queue/abc/summary-toggle",
		});

		expect(html).toContain(
			renderTldrDisclosure({
				body: { text: plainText("<b>Key</b> points.") },
				excerpt: "Teaser.",
				open: true,
				toggleUrl: "/queue/abc/summary-toggle",
			}),
		);
		const details = slotOf(html).querySelector("details");
		assert(details, "the disclosure must be rendered inside the slot");
		expect(details.getAttribute("data-summary-toggle-url")).toBe("/queue/abc/summary-toggle");
		expect(details.hasAttribute("open")).toBe(true);
	});
});
