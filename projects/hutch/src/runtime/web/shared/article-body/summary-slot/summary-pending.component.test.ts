import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSummaryPending } from "./summary-pending.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function pendingSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-reader-summary]");
	assert(slot, "summary slot must be rendered");
	return slot;
}

describe("renderSummaryPending", () => {
	it("renders the polling panel with its poll attributes, sparkles heading and its own progress", () => {
		const doc = parse(
			renderSummaryPending({ kind: "polling", pollUrl: "/queue/abc/summary?poll=1", pct: 29 }),
		);

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.hasAttribute("data-background-request")).toBe(true);
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/summary?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");

		const title = slot.querySelector("[data-test-summary-pending-title]");
		assert(title, "the panel heading must be rendered");
		expect(title.textContent).toBe("Generating summary");
		const icon = title.querySelector(".article-body__summary-icon");
		assert(icon, "the heading's icon box must be rendered");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.querySelectorAll("svg").length).toBe(1);

		const description = slot.querySelector("[data-test-summary-pending-text]");
		assert(description, "the description must be rendered");
		expect(description.classList.contains("article-body__panel-text--hidden")).toBe(true);

		const bar = slot.querySelector('[data-test-progress-bar="summary"]');
		assert(bar, "the summary progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--visible")).toBe(true);
		expect(bar.querySelector("[data-test-progress-label]")?.textContent).toBe("29% complete");
		const track = bar.querySelector('[role="progressbar"]');
		assert(track, "the track must be rendered");
		expect(track.getAttribute("aria-valuenow")).toBe("29");
		expect(track.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));
		expect(title.getAttribute("id")).toBe("article-body-summary-pending-title");
	});

	it("renders the exhausted panel with no poll attributes, a visible description and a hidden progress block", () => {
		const doc = parse(renderSummaryPending({ kind: "exhausted" }));

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("data-summary-status")).toBe("pending");
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(slot.hasAttribute("data-background-request")).toBe(false);
		expect(slot.querySelector("[data-test-summary-pending-title]")?.textContent).toBe(
			"Generating summary",
		);

		const description = slot.querySelector("[data-test-summary-pending-text]");
		assert(description, "the description must be rendered");
		expect(description.classList.contains("article-body__panel-text--visible")).toBe(true);
		expect(description.textContent).toBe("Taking a while — refresh to check again.");

		const bar = slot.querySelector('[data-test-progress-bar="summary"]');
		assert(bar, "the summary progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--hidden")).toBe(true);
		expect(bar.children.length).toBe(0);
	});

	it("carries hx-swap-oob when rendered as an out-of-band sibling", () => {
		const doc = parse(
			renderSummaryPending({
				kind: "polling",
				pollUrl: "/queue/abc/summary?poll=1",
				pct: 90,
				oob: true,
			}),
		);

		expect(pendingSlot(doc).getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("leaves hx-swap-oob off when it is the primary swap target", () => {
		const doc = parse(renderSummaryPending({ kind: "exhausted" }));

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("id")).toBe("article-body-summary-slot");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
