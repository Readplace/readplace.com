import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type ReaderFailedVariant,
	renderReaderFailed,
} from "./reader-failed.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderFailed", () => {
	it("renders the reassuring 'Your link is saved' title regardless of variant", () => {
		for (const variant of ["failed", "unsupported", "slow"] as const) {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			assert.equal(
				doc.querySelector(".article-body__reader-notice-title")?.textContent,
				"Your link is saved",
				`title for variant=${variant}`,
			);
		}
	});

	it("renders the primary CTA pointing at the source URL with the hostname in the visible text", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/some-article",
				variant: "failed",
			}),
		);

		const primary = doc.querySelector("[data-test-reader-failed-primary]");
		assert(primary, "primary CTA must be rendered");
		assert.equal(primary.getAttribute("href"), "https://example.com/some-article");
		assert.equal(primary.getAttribute("target"), "_blank");
		assert.equal(primary.getAttribute("rel"), "noopener");
		assert.match(primary.textContent ?? "", /example\.com/);
	});

	it("uses a different one-line explanation per variant", () => {
		const cases: Array<[ReaderFailedVariant, RegExp]> = [
			["unsupported", /not webpages which we yet don't show/],
			["failed", /blocking automated fetches/],
			["slow", /taking longer than usual/],
		];
		for (const [variant, expected] of cases) {
			const doc = parse(
				renderReaderFailed({
					url: "https://example.com/post",
					variant,
				}),
			);
			const text = doc.querySelector(".article-body__reader-notice-text")?.textContent ?? "";
			assert.match(text, expected, `explanation for variant=${variant}`);
		}
	});

	it("exposes the variant on the slot via data-reader-status (so tests can pin behaviour per variant)", () => {
		for (const variant of ["failed", "unsupported", "slow"] as const) {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, `slot must be rendered for variant=${variant}`);
			assert.equal(slot.getAttribute("data-reader-status"), variant);
		}
	});

	it("renders the extension install pitch when extensionInstallUrl is provided — for all variants", () => {
		for (const variant of ["failed", "unsupported", "slow"] as const) {
			const doc = parse(
				renderReaderFailed({
					url: "https://example.com/post",
					variant,
					extensionInstallUrl: "/install?browser=chrome",
				}),
			);

			const installCta = doc.querySelector("[data-test-reader-failed-install]");
			assert(installCta, `install CTA must be rendered for variant=${variant}`);
			assert.equal(installCta.getAttribute("href"), "/install?browser=chrome");
		}
	});

	it("omits the extension install pitch when extensionInstallUrl is not provided (extension already installed)", () => {
		const doc = parse(
			renderReaderFailed({ url: "https://example.com/post", variant: "failed" }),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "slot must render so the absence check is meaningful");
		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert.equal(installCta, null);
	});
});
