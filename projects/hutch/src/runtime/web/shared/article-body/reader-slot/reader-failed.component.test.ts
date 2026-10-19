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
	"capture-unreadable",
	"capture-missing",
] as const satisfies readonly ReaderFailedVariant[];

function noticeFor(input: { variant: ReaderFailedVariant; extensionInstallUrl?: string }): Element {
	const doc = parse(
		renderReaderFailed({
			url: destinationUrl("https://example.com/some-article"),
			articleId: "0123456789abcdef0123456789abcdef",
			variant: input.variant,
			extensionInstallUrl: input.extensionInstallUrl,
			captureRescue: "withheld",
			noticeOob: false,
		}).notice,
	);
	const notice = doc.querySelector("[data-test-reader-notice]");
	assert(notice, `notice must be rendered for variant=${input.variant}`);
	return notice;
}

function pollAffordanceOf(element: Element) {
	return {
		hxGet: element.getAttribute("hx-get"),
		hxTrigger: element.getAttribute("hx-trigger"),
		hxTarget: element.getAttribute("hx-target"),
		hxSwap: element.getAttribute("hx-swap"),
		hxDisabledElt: element.getAttribute("hx-disabled-elt"),
		backgroundRequest: element.hasAttribute("data-background-request"),
	};
}

const PITCH_VISIBLE_CLASS = "article-body__reader-notice-pitch article-body__reader-notice-pitch--visible";
const PITCH_HIDDEN_CLASS = "article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden";

describe("renderReaderFailed", () => {
	it("titles every variant 'Your link is saved' except not-found and the two capture outcomes, which say what happened to the article or to the reader's capture", () => {
		const titles: Record<ReaderFailedVariant, string> = {
			failed: "Your link is saved",
			unsupported: "Your link is saved",
			slow: "Your link is saved",
			blocked: "Your link is saved",
			"origin-down": "Your link is saved",
			"not-found": "Link saved, but the article is unavailable",
			"not-an-article": "Your link is saved",
			"capture-unreadable": "Readplace copied the page, but it isn't an article",
			"capture-missing": "The copy from your device didn't arrive",
		};
		for (const variant of ALL_VARIANTS) {
			const title = noticeFor({ variant }).querySelector(".article-body__reader-notice-title");
			assert(title, `title must be rendered for variant=${variant}`);
			assert.equal(title.tagName, "H2");
			assert.equal(title.textContent?.trim(), titles[variant], `title for variant=${variant}`);
			assert.equal(title.children.length, 0, `title for variant=${variant} carries no icon`);
		}
	});

	it("labels the primary CTA for the original page without naming its host, opening it in a new tab", () => {
		const labels: Record<ReaderFailedVariant, string> = {
			failed: "Read original article",
			unsupported: "Read original article",
			slow: "Read original article",
			blocked: "Read original article",
			"origin-down": "Read original article",
			"not-found": "Visit original page",
			"not-an-article": "Read original article",
			"capture-unreadable": "Read original article",
			"capture-missing": "Read original article",
		};
		for (const variant of ALL_VARIANTS) {
			const primary = noticeFor({ variant }).querySelector("[data-test-reader-failed-primary]");
			assert(primary, `primary CTA must be rendered for variant=${variant}`);
			assert.equal(primary.textContent?.trim(), labels[variant], `CTA for variant=${variant}`);
			assert.equal(primary.children.length, 0, `CTA for variant=${variant} carries no icon`);
			assert.equal(primary.getAttribute("href"), "https://example.com/some-article");
			assert.equal(primary.getAttribute("target"), "_blank");
			assert.equal(primary.getAttribute("rel"), "noopener");
		}
	});

	it("explains each variant in the product's voice, naming the next step", () => {
		const explanations: Record<ReaderFailedVariant, string> = {
			unsupported:
				"This type of page isn't supported in the Readplace reader yet. You can still open it on the original site.",
			failed:
				"Readplace couldn't load the full article from this site. You can still read it on the original website, or save the full page using the browser extension or the iPhone app.",
			slow: "Reader view is taking longer than usual.",
			blocked:
				"This site blocked Readplace from loading the full article. Use the browser extension or the iPhone app to save the complete page instead.",
			"origin-down":
				"Readplace couldn't reach this site right now. It may be temporarily unavailable, so you can try again later.",
			"not-found": "This page no longer appears to exist, so Readplace couldn't retrieve the article content.",
			"not-an-article": "This link isn't an article, so it can't be shown in reader view.",
			"capture-unreadable":
				"The saved copy of this page has no article in it to show in reader view. You can read it on the original site, or capture it again once the article has loaded.",
			"capture-missing":
				"Readplace didn't receive a copy of this page from your device. You can capture it again, or read it on the original site.",
		};
		for (const variant of ALL_VARIANTS) {
			const text = noticeFor({ variant }).querySelector(".article-body__reader-notice-text");
			assert(text, `explanation must be rendered for variant=${variant}`);
			assert.equal(text.textContent?.trim(), explanations[variant], `explanation for variant=${variant}`);
		}
	});

	it("leads every variant's card with the book-and-lightbulb illustration", () => {
		for (const variant of ALL_VARIANTS) {
			const lead = noticeFor({ variant }).firstElementChild;
			assert(lead, `notice for variant=${variant} must have content`);
			assert.equal(lead.className, "article-body__reader-notice-illustration");
			assert.equal(
				lead.querySelectorAll('[data-test-illustration="book-lightbulb"]').length,
				1,
				`illustration for variant=${variant}`,
			);
		}
	});

	it("exposes the variant on both the in-card marker and the notice via data-reader-status (so tests can pin behaviour per variant)", () => {
		for (const variant of ALL_VARIANTS) {
			const { slot, notice } = renderReaderFailed({
				url: destinationUrl("https://example.com/post"),
				articleId: "0123456789abcdef0123456789abcdef",
				variant,
				captureRescue: "withheld",
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
			articleId: "0123456789abcdef0123456789abcdef",
			variant: "failed",
			captureRescue: "offered",
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
				articleId: "0123456789abcdef0123456789abcdef",
				variant: "failed",
				captureRescue: "offered",
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

	it("closes the card with an info alert pitching a capture when extensionInstallUrl is provided — for every variant a capture could still rescue", () => {
		for (const variant of ["failed", "unsupported", "slow", "blocked"] as const) {
			const notice = noticeFor({ variant, extensionInstallUrl: "/install?client=chrome" });

			const pitch = notice.querySelector(".article-body__reader-notice-pitch");
			assert(pitch, `pitch wrapper must be rendered for variant=${variant}`);
			assert.equal(pitch.className, PITCH_VISIBLE_CLASS, `pitch for variant=${variant}`);
			assert.equal(notice.lastElementChild, pitch, `the pitch closes the card for variant=${variant}`);
			const alert = pitch.querySelector(
				'[data-test-alert="reader-capture-pitch"][data-test-alert-variant="info"][role="status"]',
			);
			assert(alert, `info alert must be rendered for variant=${variant}`);
			assert.equal(
				alert.querySelector("[data-test-alert-title]")?.textContent,
				"Want the full article in Readplace? Save it with the browser extension or the iPhone app.",
			);
			const installCta = alert.querySelector("[data-test-reader-failed-install]");
			assert(installCta, `install link must be rendered for variant=${variant}`);
			assert.equal(installCta.textContent, "See ways to save");
			assert.equal(
				installCta.getAttribute("href"),
				`/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-${variant}`,
			);
		}
	});

	it("withholds the capture pitch where no capture can help — a deleted page, a dead origin, a link that is not an article — where the reader already captured, and when the extension is installed", () => {
		const cases: Array<{ variant: ReaderFailedVariant; extensionInstallUrl: string | undefined }> = [
			{ variant: "not-found", extensionInstallUrl: "/install?client=chrome" },
			{ variant: "origin-down", extensionInstallUrl: "/install?client=chrome" },
			{ variant: "not-an-article", extensionInstallUrl: "/install?client=chrome" },
			{ variant: "capture-unreadable", extensionInstallUrl: "/install?client=chrome" },
			{ variant: "capture-missing", extensionInstallUrl: "/install?client=chrome" },
			{ variant: "failed", extensionInstallUrl: undefined },
		];
		for (const { variant, extensionInstallUrl } of cases) {
			const notice = noticeFor({ variant, extensionInstallUrl });

			const pitch = notice.querySelector(".article-body__reader-notice-pitch");
			assert(pitch, `pitch wrapper must be rendered for variant=${variant}`);
			assert.equal(pitch.className, PITCH_HIDDEN_CLASS, `pitch for variant=${variant}`);
			const alert = pitch.querySelector('[data-test-alert="reader-capture-pitch"]');
			assert(alert, `alert slot must be rendered for variant=${variant}`);
			assert.equal(alert.className, "alert alert--hidden", `alert for variant=${variant}`);
		}
	});

	it("renders the capture control on every variant and marks it with the state it is told", () => {
		for (const variant of ALL_VARIANTS) {
			for (const captureRescue of ["offered", "withheld"] as const) {
				const doc = parse(
					renderReaderFailed({
						url: destinationUrl("https://example.com/some-article"),
						articleId: "0123456789abcdef0123456789abcdef",
						variant,
						captureRescue,
						noticeOob: false,
					}).notice,
				);

				const capture = doc.querySelector('[data-test-reader-notice] [data-test-reader-action="capture"]');
				assert(capture, `capture control must be rendered for variant=${variant} captureRescue=${captureRescue}`);
				assert.equal(capture.getAttribute("type"), "button");
				assert.equal(capture.textContent, "Capture it here");
				assert.equal(capture.children.length, 0, "the capture control carries no icon");
				assert.deepEqual(
					{
						offered: capture.classList.contains("article-body__reader-notice-capture--offered"),
						withheld: capture.classList.contains("article-body__reader-notice-capture--withheld"),
					},
					{ offered: captureRescue === "offered", withheld: captureRescue === "withheld" },
					`capture state for variant=${variant} captureRescue=${captureRescue}`,
				);
			}
		}
	});

	it("stamps the capture kick-off URL on the control whatever the variant", () => {
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/some-article"),
				articleId: "0123456789abcdef0123456789abcdef",
				variant: "failed",
				captureRescue: "offered",
				capturePollUrl: "/queue/abc/reader?poll=1&capturing=1",
				noticeOob: false,
			}).notice,
		);

		const capture = doc.querySelector('[data-test-reader-notice] [data-test-reader-action="capture"]');
		assert(capture, "the failed notice must render a capture control");
		assert.equal(capture.getAttribute("data-reader-capture-poll"), "/queue/abc/reader?poll=1&capturing=1");
	});

	it("the notice section and the capture button carry the htmx poll affordances", () => {
		const capturePollUrl = "/queue/abc/reader?poll=1&capturing=1&platform=ios";
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/some-article"),
				articleId: "0123456789abcdef0123456789abcdef",
				variant: "blocked",
				captureRescue: "offered",
				capturePollUrl,
				noticeOob: false,
			}).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the blocked notice must be rendered");
		const capture = notice.querySelector('[data-test-reader-action="capture"]');
		assert(capture, "the blocked notice must render its capture control");
		assert.deepEqual(pollAffordanceOf(notice), {
			hxGet: capturePollUrl,
			hxTrigger: "readplace-capture-started from:document",
			hxTarget: "#article-body-reader-slot",
			hxSwap: "outerHTML show:none",
			hxDisabledElt: null,
			backgroundRequest: true,
		});
		assert.deepEqual(
			{ ...pollAffordanceOf(capture), capturePoll: capture.getAttribute("data-reader-capture-poll") },
			{
				hxGet: capturePollUrl,
				hxTrigger: "click",
				hxTarget: "#article-body-reader-slot",
				hxSwap: "outerHTML show:none",
				hxDisabledElt: "this",
				backgroundRequest: true,
				capturePoll: capturePollUrl,
			},
		);
	});

	it("gives a notice without a capture poll URL no poll affordance", () => {
		const doc = parse(
			renderReaderFailed({
				url: destinationUrl("https://example.com/some-article"),
				articleId: "0123456789abcdef0123456789abcdef",
				variant: "slow",
				captureRescue: "withheld",
				noticeOob: false,
			}).notice,
		);

		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the slow notice must be rendered");
		const capture = notice.querySelector('[data-test-reader-action="capture"]');
		assert(capture, "the slow notice must render its capture control");
		const inert = {
			hxGet: null,
			hxTrigger: null,
			hxTarget: null,
			hxSwap: null,
			hxDisabledElt: null,
			backgroundRequest: false,
		};
		assert.deepEqual([pollAffordanceOf(notice), pollAffordanceOf(capture)], [inert, inert]);
	});

	it("publishes the rescue URL and article id only on a notice whose capture is offered with a capture poll and an article id", () => {
		const RESCUE_URL = "data-reader-rescue-url";
		const RESCUE_ID = "data-reader-article-id";
		const articleId = "0123456789abcdef0123456789abcdef";
		const capturePollUrl = "/queue/0123456789abcdef0123456789abcdef/reader?poll=1&capturing=1";
		const rows: Array<{
			captureRescue: "offered" | "withheld";
			capturePollUrl: string | undefined;
			articleId: string | undefined;
			url: string;
			expected: { rescueUrl: string | null; articleId: string | null };
		}> = [
			{
				captureRescue: "offered",
				capturePollUrl,
				articleId,
				url: "https://example.com/a",
				expected: { rescueUrl: "https://example.com/a", articleId },
			},
			{
				captureRescue: "offered",
				capturePollUrl,
				articleId,
				url: "https://archive.ph/abc12",
				expected: { rescueUrl: "https://archive.ph/abc12", articleId },
			},
			{
				captureRescue: "withheld",
				capturePollUrl,
				articleId,
				url: "https://example.com/a",
				expected: { rescueUrl: null, articleId: null },
			},
			{
				captureRescue: "offered",
				capturePollUrl: undefined,
				articleId,
				url: "https://example.com/a",
				expected: { rescueUrl: null, articleId: null },
			},
			{
				captureRescue: "offered",
				capturePollUrl,
				articleId: undefined,
				url: "https://example.com/a",
				expected: { rescueUrl: null, articleId: null },
			},
		];
		for (const row of rows) {
			const doc = parse(
				renderReaderFailed({
					url: destinationUrl(row.url),
					articleId: row.articleId,
					variant: "blocked",
					captureRescue: row.captureRescue,
					capturePollUrl: row.capturePollUrl,
					noticeOob: false,
				}).notice,
			);
			const label = `captureRescue=${row.captureRescue} capturePollUrl=${row.capturePollUrl} articleId=${row.articleId} url=${row.url}`;
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, `the notice must be rendered for ${label}`);
			assert(notice.querySelector("[data-reader-capture]"), `the capture button must be rendered for ${label}`);
			assert.deepEqual(
				{ rescueUrl: notice.getAttribute(RESCUE_URL), articleId: notice.getAttribute(RESCUE_ID) },
				row.expected,
				label,
			);
		}
	});
});
