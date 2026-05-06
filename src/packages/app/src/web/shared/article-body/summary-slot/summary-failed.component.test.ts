import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummaryFailed } from "./summary-failed.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderSummaryFailed", () => {
	it("renders a visible slot with status=failed, the lead copy, and the reason detail", () => {
		const doc = parse(renderSummaryFailed({ reason: "deepseek timeout" }));

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered");
		expect(slot.getAttribute("data-summary-status")).toBe("failed");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		expect(
			doc.querySelector(".article-body__summary-error")?.textContent,
		).toContain("couldn't generate a summary");
		const detail = doc.querySelector(
			"[data-test-reader-summary-failure-reason]",
		);
		assert(detail, "failure reason detail must be rendered");
		expect(detail.textContent).toBe("deepseek timeout");
	});
});
