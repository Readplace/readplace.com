import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	renderExtensionSuggestionBanner,
	renderExtensionSuggestionBannerOob,
} from "./extension-suggestion-banner.component";

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

	describe("out-of-band swap envelope", () => {
		it("gives the banner a stable id so an OOB swap can target it", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const banner = doc.querySelector(".extension-suggestion-banner");
			assert(banner, "banner must be rendered");
			expect(banner.id).toBe("extension-suggestion-banner");
		});

		it("omits hx-swap-oob on the inline (SSR) render", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const banner = doc.querySelector("#extension-suggestion-banner");
			assert(banner, "banner must be rendered");
			expect(banner.hasAttribute("hx-swap-oob")).toBe(false);
		});

		it("carries an hx-swap-oob=outerHTML envelope on the OOB render", () => {
			const doc = parse(
				renderExtensionSuggestionBannerOob({ show: true, extensionInstalled: false }),
			);

			const banner = doc.querySelector("#extension-suggestion-banner");
			assert(banner, "banner must be rendered");
			expect(banner.getAttribute("hx-swap-oob")).toBe("outerHTML");
		});

		it("mirrors the show flag on the OOB render", () => {
			const shown = parse(
				renderExtensionSuggestionBannerOob({ show: true, extensionInstalled: false }),
			);
			const hidden = parse(
				renderExtensionSuggestionBannerOob({ show: false, extensionInstalled: false }),
			);

			const shownBanner = shown.querySelector("#extension-suggestion-banner");
			const hiddenBanner = hidden.querySelector("#extension-suggestion-banner");
			assert(shownBanner && hiddenBanner, "banners must be rendered");
			expect(shownBanner.getAttribute("data-show-extension-suggestion")).toBe("true");
			expect(hiddenBanner.getAttribute("data-show-extension-suggestion")).toBe("false");
		});

		it("mirrors the extensionInstalled flag on the OOB render", () => {
			const doc = parse(
				renderExtensionSuggestionBannerOob({ show: true, extensionInstalled: true }),
			);

			const message = doc.querySelector("[data-test-extension-suggestion-variant]");
			assert(message, "message variant marker must be present");
			expect(message.getAttribute("data-test-extension-suggestion-variant")).toBe(
				"installed",
			);
		});
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
			expect(url.searchParams.get("utm_source")).toBe("reader-failed");
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
			expect(url.searchParams.get("utm_source")).toBe("reader-failed");
			expect(url.searchParams.get("utm_medium")).toBe("banner");
			expect(url.searchParams.get("utm_campaign")).toBe("extension-suggestion");
			expect(url.searchParams.get("utm_content")).toBe("inline-text");
		});

		it("names every advertised content-capture surface — the browser extension and the iPhone app — and no other", () => {
			const doc = parse(renderExtensionSuggestionBanner({ show: true }));

			const message = doc.querySelector(
				"[data-test-extension-suggestion-variant='not-installed']",
			);
			assert(message, "not-installed message must be rendered");
			const text = message.textContent?.toLowerCase() ?? "";
			// The whole joined phrase, not each noun on its own: a substring check for
			// "phone app" passes on the singular too, which is how this banner drifted
			// out of step with the roster. The literal pin means a roster change lands
			// here for a deliberate re-read of the sentence around it.
			expect(text).toContain("the browser extension or the iphone app");
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

		it("renders the installed variant, which has no install CTA button (the user already has it)", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			const banner = doc.querySelector(
				"[data-test-extension-suggestion-banner]",
			);
			assert(banner, "banner must be rendered");
			const message = banner.querySelector(
				"[data-test-extension-suggestion-variant]",
			);
			assert(message, "message variant marker must be rendered");
			expect(
				message.getAttribute("data-test-extension-suggestion-variant"),
			).toBe("installed");
			expect(
				banner.querySelector("[data-test-extension-suggestion-cta]"),
			).toBeNull();
		});

		it("renders the installed variant, which has no inline install link (the user already has it)", () => {
			const doc = parse(
				renderExtensionSuggestionBanner({ show: true, extensionInstalled: true }),
			);

			const banner = doc.querySelector(
				"[data-test-extension-suggestion-banner]",
			);
			assert(banner, "banner must be rendered");
			const message = banner.querySelector(
				"[data-test-extension-suggestion-variant]",
			);
			assert(message, "message variant marker must be rendered");
			expect(
				message.getAttribute("data-test-extension-suggestion-variant"),
			).toBe("installed");
			expect(
				banner.querySelector("[data-test-extension-suggestion-inline]"),
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
