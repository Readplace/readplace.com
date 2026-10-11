import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderPending } from "./reader-pending.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function pendingSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-reader-slot]");
	assert(slot, "reader slot must be rendered");
	return slot;
}

describe("renderReaderPending", () => {
	it("renders the crawl panel with its poll attributes, title, description and progress", () => {
		const doc = parse(
			renderReaderPending({
				kind: "crawl",
				pollUrl: "/queue/abc/reader?poll=1",
				pct: 49,
				descriptions: ["Cleaning up this article."],
			}),
		);

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.hasAttribute("data-background-request")).toBe(true);
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");

		const title = slot.querySelector("[data-test-reader-pending-title]");
		assert(title, "the panel title must be rendered");
		expect(title.textContent).toBe("Preparing your reader view");

		const descriptions = Array.from(
			slot.querySelectorAll("[data-test-reader-pending-text]"),
		).map((el) => el.textContent);
		expect(descriptions).toEqual(["Cleaning up this article."]);

		const bar = slot.querySelector('[data-test-progress-bar="reader"]');
		assert(bar, "the reader progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--visible")).toBe(true);
		const track = bar.querySelector('[role="progressbar"]');
		assert(track, "the track must be rendered");
		expect(track.getAttribute("aria-valuenow")).toBe("49");
		expect(track.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));
		expect(title.getAttribute("id")).toBe("article-body-reader-pending-title");
	});

	it("renders two descriptions in the order given", () => {
		const doc = parse(
			renderReaderPending({
				kind: "crawl",
				pollUrl: "/queue/abc/reader?poll=1",
				pct: 8,
				descriptions: ["First line.", "Second line."],
			}),
		);

		const descriptions = Array.from(
			pendingSlot(doc).querySelectorAll("[data-test-reader-pending-text]"),
		).map((el) => el.textContent);
		expect(descriptions).toEqual(["First line.", "Second line."]);
	});

	it("renders the capture panel with its own title, no description and a hidden progress block", () => {
		const doc = parse(
			renderReaderPending({
				kind: "capture",
				pollUrl: "/queue/abc/reader?poll=1&capturing=1",
			}),
		);

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1&capturing=1");
		expect(slot.querySelector("[data-test-reader-pending-title]")?.textContent).toBe(
			"Copying the page from your device",
		);
		expect(slot.querySelectorAll("[data-test-reader-pending-text]").length).toBe(0);

		const bar = slot.querySelector('[data-test-progress-bar="reader"]');
		assert(bar, "the reader progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--hidden")).toBe(true);
		expect(bar.children.length).toBe(0);
	});

	it("carries hx-swap-oob when rendered as an out-of-band sibling", () => {
		const doc = parse(
			renderReaderPending({
				kind: "crawl",
				pollUrl: "/queue/abc/reader?poll=1",
				pct: 8,
				descriptions: [],
				oob: true,
			}),
		);

		expect(pendingSlot(doc).getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("leaves hx-swap-oob off when it is the primary swap target", () => {
		const doc = parse(
			renderReaderPending({
				kind: "capture",
				pollUrl: "/queue/abc/reader?poll=1&capturing=1",
			}),
		);

		const slot = pendingSlot(doc);
		expect(slot.getAttribute("id")).toBe("article-body-reader-slot");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
