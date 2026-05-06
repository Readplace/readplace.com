import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderPending } from "./reader-pending.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderPending", () => {
	it("renders polling attributes and the fetching message when pollUrl is provided", () => {
		const doc = parse(
			renderReaderPending({ pollUrl: "/queue/abc/reader?poll=1" }),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		expect(doc.querySelector(".article-body__reader-loading")?.textContent).toBe(
			"Fetching article",
		);
	});

	it("renders a terminal slot without polling attributes when pollUrl is omitted", () => {
		const doc = parse(renderReaderPending({}));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(
			doc.querySelector(".article-body__reader-loading")?.textContent,
		).toContain("Still fetching");
	});
});
