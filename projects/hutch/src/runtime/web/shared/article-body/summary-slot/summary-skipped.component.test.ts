import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummarySkipped } from "./summary-skipped.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function skippedSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-reader-summary]");
	assert(slot, "summary slot must be rendered");
	return slot;
}

function skippedAlert(slot: Element): Element {
	const alert = slot.querySelector('[data-test-alert="reader-summary-skipped"]');
	assert(alert, "the skipped alert must be rendered");
	return alert;
}

describe("renderSummarySkipped", () => {
	it("renders a visible, title-only info alert with the content-too-short message", () => {
		const doc = parse(renderSummarySkipped({ reason: "content-too-short" }));

		const slot = skippedSlot(doc);
		expect(slot.getAttribute("data-summary-status")).toBe("skipped");
		expect(slot.classList.contains("article-body__summary-slot--visible")).toBe(
			true,
		);
		expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"content-too-short",
		);
		const alert = skippedAlert(slot);
		expect(alert.getAttribute("data-test-alert-variant")).toBe("info");
		expect(alert.getAttribute("role")).toBe("status");
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"This article is too short to generate a summary.",
		);
		expect(alert.querySelectorAll("[data-test-alert-message]").length).toBe(0);
	});

	it.each(["ai-unavailable", "declined"])(
		"renders the no-useful-summary message when the reason is %s",
		(reason) => {
			const doc = parse(renderSummarySkipped({ reason }));

			const slot = skippedSlot(doc);
			expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe(reason);
			expect(skippedAlert(slot).querySelector("[data-test-alert-title]")?.textContent).toBe(
				"Readplace couldn't generate a useful summary for this article.",
			);
		},
	);

	it("falls back to a generic message when reason is undefined (legacy rows)", () => {
		const doc = parse(renderSummarySkipped({ reason: undefined }));

		const slot = skippedSlot(doc);
		expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe("");
		expect(skippedAlert(slot).querySelector("[data-test-alert-title]")?.textContent).toBe(
			"No summary was generated for this article.",
		);
	});

	it("falls back to a generic message for forward-compat unknown reasons", () => {
		const doc = parse(renderSummarySkipped({ reason: "future-reason" }));

		const slot = skippedSlot(doc);
		expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe(
			"future-reason",
		);
		expect(skippedAlert(slot).querySelector("[data-test-alert-title]")?.textContent).toBe(
			"No summary was generated for this article.",
		);
	});

	it("carries hx-swap-oob when rendered as an out-of-band sibling", () => {
		const doc = parse(renderSummarySkipped({ reason: "content-too-short", oob: true }));

		expect(skippedSlot(doc).getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("leaves hx-swap-oob off when it is the primary swap target", () => {
		const doc = parse(renderSummarySkipped({ reason: "content-too-short" }));

		const slot = skippedSlot(doc);
		expect(slot.getAttribute("id")).toBe("article-body-summary-slot");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
