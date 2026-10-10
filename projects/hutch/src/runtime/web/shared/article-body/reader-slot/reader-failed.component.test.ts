import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { destinationUrl } from "../../../test-helpers/article-fixtures";
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
		renderReaderFailed({ url: destinationUrl("https://example.com/some-article"), variant, noticeOob: false }).notice,
	);
	return doc.querySelector("[data-test-reader-failed-primary]")?.textContent?.trim() ?? "";
}

describe("renderReaderFailed", () => {
	it("renders the reassuring 'Your link is saved' title regardless of variant", () => {
		for (const variant of ALL_VARIANTS) {
			const doc = parse(
				renderReaderFailed({ url: destinationUrl("https://example.com/post"), variant, noticeOob: false }).notice,
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
				url: destinationUrl("https://example.com/some-article"),
				variant: "failed",
				noticeOob: false,
			}).notice,
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
					url: destinationUrl("https://example.com/post"),
					variant,
					noticeOob: false,
				}).notice,
			);
			const text = doc.querySelector(".article-body__reader-notice-text")?.textContent ?? "";
			assert.match(text, expected, `explanation for variant=${variant}`);
		}
	});

	it("exposes the variant on both the in-card marker and the notice via data-reader-status (so tests can pin behaviour per variant)", () => {
		for (const variant of ALL_VARIANTS) {
			const { slot, notice } = renderReaderFailed({
				url: destinationUrl("https://example.com/post"),
				variant,
				noticeOob: false,
			});
			const marker = parse(slot).querySelector("[data-test-reader-slot]");
			assert(marker, `marker must be rendered for variant=${variant}`);
			assert.equal(marker.getAttribute("data-reader-status"), variant);
			assert.equal(marker.children.length, 0, `marker for variant=${variant} carries no notice content`);
			const card = parse(notice).querySelector("[data-test-reader-notice]");
			assert(card, `notice must be rendered for variant=${variant}`);
			assert.equal(card.getAttribute("data-reader-status"), variant);
		}
	});

	it("keeps the in-card marker on the slot id and renders the notice as its own visible card", () => {
		const { slot, notice } = renderReaderFailed({
			url: destinationUrl("https://example.com/post"),
			variant: "failed",
			noticeOob: false,
		});

		const marker = parse(slot).querySelector("[data-test-reader-slot]");
		assert(marker, "marker must be rendered");
		assert.equal(marker.id, "article-body-reader-slot");
		assert.equal(marker.className, "article-body__reader-slot article-body__reader-slot--notice");
		const card = parse(notice).querySelector("[data-test-reader-notice]");
		assert(card, "notice must be rendered");
		assert.equal(card.id, "article-body-reader-notice");
		assert.equal(card.tagName, "SECTION");
		assert.equal(
			card.className,
			"article-body__card article-body__reader-notice article-body__reader-notice--visible",
		);
	});

	it("marks the marker and the notice out of band independently, so a poll can splice either region in by id", () => {
		const cases = [
			{ oob: false, noticeOob: false, expected: [null, null] },
			{ oob: true, noticeOob: false, expected: ["outerHTML", null] },
			{ oob: false, noticeOob: true, expected: [null, "outerHTML"] },
			{ oob: true, noticeOob: true, expected: ["outerHTML", "outerHTML"] },
		];
		for (const { oob, noticeOob, expected } of cases) {
			const { slot, notice } = renderReaderFailed({
				url: destinationUrl("https://example.com/post"),
				variant: "failed",
				oob,
				noticeOob,
			});
			const marker = parse(slot).querySelector("[data-test-reader-slot]");
			const card = parse(notice).querySelector("[data-test-reader-notice]");
			assert(marker, "marker must be rendered");
			assert(card, "notice must be rendered");
			assert.deepEqual(
				[marker.getAttribute("hx-swap-oob"), card.getAttribute("hx-swap-oob")],
				expected,
				`oob=${oob} noticeOob=${noticeOob}`,
			);
		}
	});

	it("renders the extension install pitch when extensionInstallUrl is provided — for every variant a capture could still rescue", () => {
		for (const variant of ["failed", "unsupported", "slow", "blocked"] as const) {
			const doc = parse(
				renderReaderFailed({
					url: destinationUrl("https://example.com/post"),
					variant,
					extensionInstallUrl: "/install?client=chrome",
					noticeOob: false,
				}).notice,
			);

			const installCta = doc.querySelector("[data-test-reader-failed-install]");
			assert(installCta, `install CTA must be rendered for variant=${variant}`);
			assert.equal(
				installCta.getAttribute("href"),
				`/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-${variant}`,
			);
			assert.match(
				doc.body.textContent ?? "",
				/Tip: the browser extension and the iPhone app capture the full page in one tap/,
			);
		}
	});

	it("offers the capture control only on the blocked variant — the one failure the reader's own host can still fix", () => {
		function actionsFor(variant: ReaderFailedVariant): (string | null)[] {
			const doc = parse(
				renderReaderFailed({ url: destinationUrl("https://example.com/post"), variant, noticeOob: false }).notice,
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
				url: destinationUrl("https://example.com/post"),
				variant: "not-found",
				extensionInstallUrl: "/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-unsupported",
				noticeOob: false,
			}).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "notice must render so the absence check is meaningful");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
		assert.doesNotMatch(doc.body.textContent ?? "", /capture the full page in one tap/);
	});

	it("withholds the extension pitch on the origin-down variant — the reader's own browser would hit the same dead origin", () => {
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/post"),
				variant: "origin-down",
				extensionInstallUrl: "/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-unsupported",
				noticeOob: false,
			}).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "notice must render so the absence check is meaningful");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
		assert.doesNotMatch(doc.body.textContent ?? "", /blocking automated fetches/);
	});

	it("labels the origin-down CTA 'Try it on <host>', not 'Read it on', because the page just failed to load", () => {
		assert.equal(ctaLabelFor("origin-down"), "Try it on example.com");
	});

	it("never blames a bot wall on the not-found variant — the 404 copy must not send the reader after a fix that cannot work", () => {
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/post"),
				variant: "not-found",
				extensionInstallUrl: "/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-unsupported",
				noticeOob: false,
			}).notice,
		);

		assert.doesNotMatch(doc.body.textContent ?? "", /blocking automated fetches/);
	});

	it("ships the capture control hidden and keeps the source link primary, so a plain browser still sees only the affordance it can honour", () => {
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/some-article"),
				variant: "blocked",
				noticeOob: false,
			}).notice,
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
				url: destinationUrl("https://mail.google.com/mail/u/0/"),
				variant: "not-an-article",
				extensionInstallUrl: "/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-unsupported",
				noticeOob: false,
			}).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "notice must render so the absence check is meaningful");
		assert.equal(notice.getAttribute("data-reader-status"), "not-an-article");
		assert.equal(doc.querySelector("[data-test-reader-failed-install]"), null);
	});

	it("omits the extension install pitch when extensionInstallUrl is not provided (extension already installed)", () => {
		const doc = parse(
			renderReaderFailed({ url: destinationUrl("https://example.com/post"), variant: "failed", noticeOob: false }).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "notice must render so the absence check is meaningful");
		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert.equal(installCta, null);
	});
});
