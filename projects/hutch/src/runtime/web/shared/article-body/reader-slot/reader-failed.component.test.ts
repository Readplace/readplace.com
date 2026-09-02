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

const ALL_VARIANTS = [
	"failed",
	"unsupported",
	"slow",
	"blocked",
	"origin-down",
	"not-found",
	"not-an-article",
] as const satisfies readonly ReaderFailedVariant[];

function ctaLabelFor(variant: ReaderFailedVariant): string {
	const doc = parse(
		renderReaderFailed({ url: "https://example.com/some-article", variant }),
	);
	return doc.querySelector("[data-test-reader-failed-primary]")?.textContent?.trim() ?? "";
}

describe("renderReaderFailed", () => {
	it("renders the reassuring 'Your link is saved' title regardless of variant", () => {
		for (const variant of ALL_VARIANTS) {
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
			["origin-down", /its server was down, not blocking us/],
			["not-found", /no longer exists at this address/],
			["not-an-article", /This link isn't an article, so there's no reader view\./],
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
		for (const variant of ALL_VARIANTS) {
			const doc = parse(
				renderReaderFailed({ url: "https://example.com/post", variant }),
			);
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, `slot must be rendered for variant=${variant}`);
			assert.equal(slot.getAttribute("data-reader-status"), variant);
		}
	});

	it("renders the extension install pitch when extensionInstallUrl is provided — for every variant a capture could still rescue", () => {
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
				/Tip: the browser extension and phone apps capture the full page in one tap/,
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
		for (const variant of ["failed", "unsupported", "slow", "origin-down", "not-found", "not-an-article"] as const) {
			assert.deepEqual(actionsFor(variant), ["open"], `actions for variant=${variant}`);
		}
	});

	it("withholds the extension pitch on the not-found variant — no client can capture a page the origin has deleted", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/post",
				variant: "not-found",
				extensionInstallUrl: "/install?client=chrome",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "slot must render so the absence check is meaningful");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
		assert.doesNotMatch(doc.body.textContent ?? "", /capture the full page in one tap/);
	});

	it("withholds the extension pitch on the origin-down variant — the reader's own browser would hit the same dead origin", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/post",
				variant: "origin-down",
				extensionInstallUrl: "/install?client=chrome",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "slot must render so the absence check is meaningful");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
		assert.doesNotMatch(doc.body.textContent ?? "", /blocking automated fetches/);
	});

	it("labels the origin-down CTA 'Try it on <host>', not 'Read it on', because the page just failed to load", () => {
		assert.equal(ctaLabelFor("origin-down"), "Try it on example.com");
	});

	it("never blames a bot wall on the not-found variant — the 404 copy must not send the reader after a fix that cannot work", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/post",
				variant: "not-found",
				extensionInstallUrl: "/install?client=chrome",
			}),
		);

		assert.doesNotMatch(doc.body.textContent ?? "", /blocking automated fetches/);
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
			capture.className,
			"btn btn--secondary article-body__reader-notice-capture",
		);
		assert.equal(
			doc.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			"https://example.com/some-article",
		);
	});

	it("names the source host in the primary CTA on every variant a fetch could still have worked for", () => {
		for (const variant of ["failed", "unsupported", "slow", "blocked", "not-found"] as const) {
			assert.equal(ctaLabelFor(variant), "Read it on example.com", `CTA for variant=${variant}`);
		}
	});

	it("drops the host from the primary CTA on the not-an-article variant — there is nothing to read on it", () => {
		assert.equal(ctaLabelFor("not-an-article"), "View the link");
	});

	it("withholds the extension pitch on the not-an-article variant — a capture of a mail session is not an article either", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://mail.google.com/mail/u/0/",
				variant: "not-an-article",
				extensionInstallUrl: "/install?client=chrome",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "slot must render so the absence check is meaningful");
		assert.equal(slot.getAttribute("data-reader-status"), "not-an-article");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
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
