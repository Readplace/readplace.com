import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummaryFailed } from "./summary-failed.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function failedSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-reader-summary]");
	assert(slot, "summary slot must be rendered");
	return slot;
}

describe("renderSummaryFailed", () => {
	it("renders a visible slot holding the error alert with its fixed title and message", () => {
		const doc = parse(renderSummaryFailed({}));

		const slot = failedSlot(doc);
		expect(slot.getAttribute("data-summary-status")).toBe("failed");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		const alert = slot.querySelector('[data-test-alert="reader-summary-failed"]');
		assert(alert, "the failure alert must render");
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"Summary unavailable",
		);
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Readplace couldn't generate a summary for this article.",
		);
	});

	it("carries hx-swap-oob when rendered as an out-of-band sibling", () => {
		const doc = parse(renderSummaryFailed({ oob: true }));

		expect(failedSlot(doc).getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("leaves hx-swap-oob off when it is the primary swap target", () => {
		const doc = parse(renderSummaryFailed({}));

		const slot = failedSlot(doc);
		expect(slot.getAttribute("id")).toBe("article-body-summary-slot");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
