import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderPending } from "./reader-pending.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderPending", () => {
	it("renders polling attributes and the fetching message", () => {
		const doc = parse(
			renderReaderPending({ pollUrl: "/queue/abc/reader?poll=1" }),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
		expect(
			doc.querySelector(".article-body__reader-loading")?.textContent,
		).toBe("Generating clean reader view");
	});

	it("renders a supplied label in place of the default, keeping the animated-dots treatment", () => {
		const doc = parse(
			renderReaderPending({
				pollUrl: "/queue/abc/reader?poll=1&capturing=1",
				label: "Copying the page from your device",
			}),
		);

		const loading = doc.querySelector(".article-body__reader-loading");
		assert(loading, "the pending label must render");
		expect(loading.textContent).toBe("Copying the page from your device");
	});

	it("omits the loading-hint subtitle when no hint is provided", () => {
		const doc = parse(
			renderReaderPending({ pollUrl: "/queue/abc/reader?poll=1" }),
		);

		expect(doc.querySelector(".article-body__reader-loading-subtitle")).toBeNull();
	});

	it("renders the loading-hint subtitle verbatim when a hint string is provided", () => {
		const doc = parse(
			renderReaderPending({
				pollUrl: "/queue/abc/reader?poll=1",
				loadingHint: "Custom hint copy",
			}),
		);

		const subtitle = doc.querySelector(".article-body__reader-loading-subtitle");
		assert(subtitle, "loading-hint subtitle must render when loadingHint is set");
		expect(subtitle.textContent).toBe("Custom hint copy");
	});
});
