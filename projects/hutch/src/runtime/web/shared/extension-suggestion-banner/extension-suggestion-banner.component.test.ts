import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderExtensionSuggestionBanner } from "./extension-suggestion-banner.component";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderExtensionSuggestionBanner", () => {
	it("always renders the banner element regardless of the show flag", () => {
		const shown = parse(renderExtensionSuggestionBanner({ show: true }));
		const hidden = parse(renderExtensionSuggestionBanner({ show: false }));

		assert(
			shown.querySelector(".extension-suggestion-banner"),
			"banner must be rendered when show=true",
		);
		assert(
			hidden.querySelector(".extension-suggestion-banner"),
			"banner must always be rendered so the client can locate it",
		);
	});

	it("sets data-show-extension-suggestion='true' when show=true", () => {
		const doc = parse(renderExtensionSuggestionBanner({ show: true }));

		const banner = doc.querySelector(".extension-suggestion-banner");
		assert(banner, "banner must be rendered");
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("true");
	});

	it("sets data-show-extension-suggestion='false' when show=false", () => {
		const doc = parse(renderExtensionSuggestionBanner({ show: false }));

		const banner = doc.querySelector(".extension-suggestion-banner");
		assert(banner, "banner must be rendered");
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("false");
	});

	it("renders a close button with an accessible label and the dismiss data attribute", () => {
		const doc = parse(renderExtensionSuggestionBanner({ show: true }));

		const closeBtn = doc.querySelector("[data-extension-suggestion-close]");
		assert(closeBtn, "close button must be rendered");
		expect(closeBtn.getAttribute("aria-label")).toBe(
			"Dismiss extension suggestion",
		);
	});

	it("renders a CTA pointing to the extension install page", () => {
		const doc = parse(renderExtensionSuggestionBanner({ show: true }));

		const cta = doc.querySelector("[data-test-extension-suggestion-cta]");
		assert(cta, "cta must be rendered");
		expect(cta.getAttribute("href")).toBe("/install");
	});
});
