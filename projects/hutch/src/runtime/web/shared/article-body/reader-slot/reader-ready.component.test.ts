import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "./reader-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderReady", () => {
	it("renders the article content inside a slot tagged ready", () => {
		const doc = parse(renderReaderReady({ content: "<p>Body copy</p>" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
		expect(slot.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("preserves the legacy data-test-reader-content attribute so existing tests can target the body", () => {
		const doc = parse(renderReaderReady({ content: "<p>x</p>" }));

		const legacyTarget = doc.querySelector("[data-test-reader-content]");
		assert(legacyTarget, "legacy data-test-reader-content must be present");
		expect(legacyTarget.innerHTML.trim()).toBe("<p>x</p>");
	});
});
