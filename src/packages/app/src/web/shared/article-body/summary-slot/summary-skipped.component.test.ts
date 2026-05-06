import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummarySkipped } from "./summary-skipped.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderSummarySkipped", () => {
	it("renders a visible info card with the content-too-short message", () => {
		const doc = parse(renderSummarySkipped({ reason: "content-too-short" }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("skipped");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"content-too-short",
		);
		expect(info.textContent).toBe("This article is too short to summarise.");
	});

	it("renders the ai-unavailable message when AI declined to summarise", () => {
		const doc = parse(renderSummarySkipped({ reason: "ai-unavailable" }));

		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"ai-unavailable",
		);
		expect(info.textContent).toBe(
			"Our summariser couldn't produce a useful summary for this article.",
		);
	});

	it("falls back to a generic message when reason is undefined (legacy rows)", () => {
		const doc = parse(renderSummarySkipped({ reason: undefined }));

		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe("");
		expect(info.textContent).toBe("No summary was generated for this article.");
	});

	it("falls back to a generic message for forward-compat unknown reasons", () => {
		const doc = parse(renderSummarySkipped({ reason: "future-reason" }));

		const info = doc.querySelector(".article-body__summary-info");
		assert(info, "info card must be rendered");
		expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"future-reason",
		);
		expect(info.textContent).toBe("No summary was generated for this article.");
	});
});
