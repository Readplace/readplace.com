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
		for (const variant of ["failed", "unsupported", "slow", "blocked"] as const) {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			assert.equal(
				doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim(),
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
			["blocked", /Open it in your browser/],
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
		for (const variant of ["failed", "unsupported", "slow", "blocked"] as const) {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, `slot must be rendered for variant=${variant}`);
			assert.equal(slot.getAttribute("data-reader-status"), variant);
		}
	});

	it("renders the extension install pitch when extensionInstallUrl is provided — for all variants", () => {
		for (const variant of ["failed", "unsupported", "slow", "blocked"] as const) {
			const doc = parse(
				renderReaderFailed({
					url: "https://example.com/post",
					variant,
					extensionInstallUrl: "/install?client=chrome",
				}),
			);

			const installCta = doc.querySelector("[data-test-reader-failed-install]");
			assert(installCta, `install CTA must be rendered for variant=${variant}`);
			assert.equal(installCta.getAttribute("href"), "/install?client=chrome");
			assert.match(
				doc.body.textContent ?? "",
				/Tip: the browser extension and iPhone app capture the full page in one tap/,
			);
		}
	});

	it("offers the capture control only on the blocked variant — the one failure the reader's own host can still fix", () => {
		function actionsFor(variant: ReaderFailedVariant): (string | null)[] {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			return Array.from(doc.querySelectorAll("[data-test-reader-action]")).map(
				(el) => el.getAttribute("data-test-reader-action"),
			);
		}

		assert.deepEqual(actionsFor("blocked"), ["open", "capture"]);
		for (const variant of ["failed", "unsupported", "slow"] as const) {
			assert.deepEqual(actionsFor(variant), ["open"], `actions for variant=${variant}`);
		}
	});

	it("ships the capture control hidden and keeps the source link primary, so a plain browser still sees only the affordance it can honour", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/some-article",
				variant: "blocked",
			}),
		);

		const capture = doc.querySelector("[data-reader-capture]");
		assert(capture, "the blocked variant must render a capture control");
		assert.equal(capture.getAttribute("type"), "button");
		assert.equal(
			capture.classList.contains("article-body__reader-notice-capture--hidden"),
			true,
		);
		assert.equal(
			doc.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			"https://example.com/some-article",
		);
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
