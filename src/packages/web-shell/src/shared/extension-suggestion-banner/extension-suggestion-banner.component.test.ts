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

	describe("when the extension is NOT installed (default)", () => {
		it("renders the install pitch variant", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: false }),
			);

			const message = doc.querySelector(
				"[data-test-extension-suggestion-variant]",
			);
			assert(message, "message variant marker must be present");
			expect(message.getAttribute("data-test-extension-suggestion-variant")).toBe(
				"not-installed",
			);
		});

		it("renders a CTA button to /install with utm_content=cta-button", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const cta = doc.querySelector("[data-test-extension-suggestion-cta]");
			assert(cta, "cta must be rendered");
			const href = cta.getAttribute("href");
			assert(href, "cta must have an href");
			const url = new URL(href, "https://readplace.com");
			expect(url.pathname).toBe("/install");
			expect(url.searchParams.get("utm_source")).toBe("web-app");
			expect(url.searchParams.get("utm_medium")).toBe("banner");
			expect(url.searchParams.get("utm_campaign")).toBe("extension-suggestion");
			expect(url.searchParams.get("utm_content")).toBe("cta-button");
		});

		it("renders an inline message link to /install with utm_content=inline-text", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const inline = doc.querySelector(
				"[data-test-extension-suggestion-inline]",
			);
			assert(inline, "inline message link must be rendered");
			const href = inline.getAttribute("href");
			assert(href, "inline link must have an href");
			const url = new URL(href, "https://readplace.com");
			expect(url.pathname).toBe("/install");
			expect(url.searchParams.get("utm_source")).toBe("web-app");
			expect(url.searchParams.get("utm_medium")).toBe("banner");
			expect(url.searchParams.get("utm_campaign")).toBe("extension-suggestion");
			expect(url.searchParams.get("utm_content")).toBe("inline-text");
		});

		it("uses distinct utm_content values on the inline link and the CTA so clicks are attributable", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const cta = doc.querySelector("[data-test-extension-suggestion-cta]");
			const inline = doc.querySelector(
				"[data-test-extension-suggestion-inline]",
			);
			assert(cta && inline, "both links must be rendered");
			const ctaContent = new URL(
				cta.getAttribute("href") ?? "",
				"https://readplace.com",
			).searchParams.get("utm_content");
			const inlineContent = new URL(
				inline.getAttribute("href") ?? "",
				"https://readplace.com",
			).searchParams.get("utm_content");
			expect(ctaContent).not.toBe(inlineContent);
		});
	});

	describe("when the extension IS installed", () => {
		it("renders the re-save variant marker", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			const message = doc.querySelector(
				"[data-test-extension-suggestion-variant]",
			);
			assert(message, "message variant marker must be present");
			expect(message.getAttribute("data-test-extension-suggestion-variant")).toBe(
				"installed",
			);
		});

		it("hides the install CTA button (the user already has it)", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			expect(
				doc.querySelector("[data-test-extension-suggestion-cta]"),
			).toBeNull();
		});

		it("hides the inline install link (the user already has it)", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			expect(
				doc.querySelector("[data-test-extension-suggestion-inline]"),
			).toBeNull();
		});

		it("tells the reader to save again using the extension", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			const message = doc.querySelector(
				"[data-test-extension-suggestion-variant='installed']",
			);
			assert(message, "installed-variant message must be rendered");
			expect(message.textContent?.toLowerCase()).toContain(
				"save it again with the readplace extension",
			);
		});
	});
});
