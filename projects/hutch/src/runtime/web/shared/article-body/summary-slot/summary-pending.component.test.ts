import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummaryPending } from "./summary-pending.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderSummaryPending", () => {
	it("renders polling attributes and the generating message when pollUrl is provided", () => {
		const doc = parse(
			renderSummaryPending({ pollUrl: "/queue/abc/summary?poll=1" }),
		);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		const loading = doc.querySelector(".article-body__summary-loading");
		assert(loading, "the pending line must render");
		expect(loading.textContent).toBe("Generating summary");
		expect(loading.querySelectorAll("svg").length).toBe(1);
	});

	it("renders a terminal slot without polling attributes when pollUrl is omitted", () => {
		const doc = parse(renderSummaryPending({}));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.hasAttribute("hx-get")).toBe(false);
		const loading = doc.querySelector(".article-body__summary-loading");
		assert(loading, "the terminal line must render");
		expect(loading.textContent).toContain("Still generating");
		expect(loading.querySelectorAll("svg").length).toBe(0);
	});
});
