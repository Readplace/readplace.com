import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { destinationUrl } from "../../../test-helpers/article-fixtures";
import { type ReaderSlotInput, renderReaderSlot } from "./reader-slot.component";
import { articleBody } from "@packages/test-fixtures";

function parse(regions: { slot: string; notice: string }) {
	return new JSDOM(
		`<!doctype html><html><body>${regions.slot}${regions.notice}</body></html>`,
	).window.document;
}

const URL = destinationUrl("https://example.com/article");
const APP_ORIGIN = "https://readplace.com";
const ARTICLE_ID = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-11-05T10:00:00.000Z");
const CAPTURE_POLL_URLS = {
	manual: "/queue/abc/reader?poll=1&captureNotice=1&captureTrigger=manual",
	automatic: "/queue/abc/reader?poll=1&captureNotice=1&captureTrigger=automatic",
};

function readerProgressTrack(doc: Document): Element {
	const track = doc.querySelector('[data-test-progress-bar="reader"] [role="progressbar"]');
	assert(track, "the reader progress track must be rendered");
	return track;
}

function crawlEstimateState(doc: Document) {
	const estimate = doc.querySelector("[data-test-reader-slot] [data-test-crawl-estimate]");
	assert(estimate, "the reader must render its crawl estimate");
	return {
		kind: ["quiet", "counting", "almost-there", "hidden"].find((state) => estimate.classList.contains(`crawl-estimate--${state}`)),
		remaining: estimate.getAttribute("data-remaining-seconds"),
	};
}

function noticeCaptureControl(doc: Document): Element {
	const capture = doc.querySelector('[data-test-reader-notice] [data-test-reader-action="capture"]');
	assert(capture, "the notice must render its capture control");
	return capture;
}

function pendingDescriptions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-reader-pending-text]")).map(
		(el) => el.textContent,
	);
}

describe("renderReaderSlot", () => {
	it("returns only the two region fragments (no outer page)", () => {
		const { slot, notice } = renderReaderSlot({
			crawl: { status: "ready" },
			content: articleBody("<p>Body</p>"),
			url: URL,
			articleId: ARTICLE_ID,
			appOrigin: APP_ORIGIN,
			noticeOob: false,
			now: NOW,
		});

		expect([slot.startsWith("<div"), notice.startsWith("<section")]).toEqual([true, true]);
		expect((slot + notice).includes("<html")).toBe(false);
	});

	it("routes status=pending with a poll URL to the pending component", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(readerProgressTrack(doc).getAttribute("aria-valuenow")).toBe("8");
	});

	it("reports the recorded crawl stage on the reader's own axis", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z", stage: "crawl-parsed" },
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(readerProgressTrack(doc).getAttribute("aria-valuenow")).toBe("49");
	});

	it.each([
		{ secondsSinceStart: 2, stage: "crawl-fetching", expected: { kind: "quiet", remaining: "148" } },
		{ secondsSinceStart: 40, stage: "crawl-fetching", expected: { kind: "counting", remaining: "120" } },
		{ secondsSinceStart: 40, stage: "crawl-content-uploaded", expected: { kind: "counting", remaining: "16" } },
		{ secondsSinceStart: 200, stage: "crawl-fetching", expected: { kind: "almost-there", remaining: "0" } },
	] as const)("estimates the seconds left $secondsSinceStart s into a crawl at $stage", ({ secondsSinceStart, stage, expected }) => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z", stage },
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: new Date(NOW.getTime() + secondsSinceStart * 1000),
			}),
		);

		expect(crawlEstimateState(doc)).toEqual(expected);
	});

	it("shows no estimate while the crawl row has not been written yet", () => {
		const doc = parse(
			renderReaderSlot({
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(crawlEstimateState(doc)).toEqual({ kind: "hidden", remaining: "0" });
	});

	it("floors the OCR part interpolation in the label", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "pending", startedAt: "2026-11-05T10:00:00.000Z",
					stage: "comprehensive-extracting",
					parts: { current: 3, total: 10 },
				},
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(
			doc.querySelector('[data-test-progress-bar="reader"] [data-test-progress-label]')?.textContent,
		).toBe("42% complete");
	});

	it("renders the PDF accuracy-over-slop loading hint when the pending URL is a .pdf", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				url: destinationUrl("https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf"),
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(pendingDescriptions(doc)).toEqual([
			"Readplace is cleaning up this article for a focused, distraction-free reading experience.",
			"Readplace optimises for accuracy over slop — low-quality PDFs may produce some optical scan gibberish.",
		]);
	});

	it("omits the loading hint when the pending URL is an HTML article", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				url: destinationUrl("https://example.com/articles/some-post"),
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(pendingDescriptions(doc)).toEqual([
			"Readplace is cleaning up this article for a focused, distraction-free reading experience.",
		]);
	});

	it("omits the loading hint when the URL is invalid (URL parse throws)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				url: destinationUrl("not-a-valid-url"),
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		expect(pendingDescriptions(doc)).toEqual([
			"Readplace is cleaning up this article for a focused, distraction-free reading experience.",
		]);
	});

	it("routes status=pending WITHOUT a poll URL to the 'slow' reframe (poll cap exhausted)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" },
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim(),
			"Your link is saved",
		);
	});

	it("routes status=failed to the failed variant", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", outcomeRevision: 1, reason: "exceeded SQS maxReceiveCount" },
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim(),
			"Your link is saved",
		);
		expect(
			doc
				.querySelector("[data-test-reader-failed-primary]")
				?.getAttribute("href"),
		).toBe(URL);
	});

	it.each([
		[JSON.stringify({ kind: "processing-failed", notice: "This book is protected by DRM." }), "This book is protected by DRM."],
		[JSON.stringify({ kind: "exhausted-retries", receiveCount: 3 }), "Readplace couldn't finish preparing this file. You can upload it again."],
		[JSON.stringify({ kind: "capture-unreadable", detail: "no readable article candidate" }), "Readplace couldn't finish preparing this file. You can upload it again."],
	])("asks the owner of a failed private item %s to upload it again, offering no capture", (reason, text) => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", outcomeRevision: 1, reason },
				url: destinationUrl("https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef"),
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
				extensionInstallUrl: "/install?client=chrome",
				capturePollUrls: CAPTURE_POLL_URLS,
			}),
		);

		expect(doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status")).toBe("processing-failed");
		expect(doc.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(text);
		const primary = doc.querySelector("[data-test-reader-failed-primary]");
		expect(primary?.textContent?.trim()).toBe("Upload again");
		expect(primary?.getAttribute("href")).toBe("/upload?utm_source=reader-failed&utm_medium=internal&utm_content=upload-again");
		expect(doc.querySelector("[data-test-reader-notice]")?.hasAttribute("data-reader-rescue-url")).toBe(false);
		expect(doc.querySelector(".article-body__reader-notice-pitch")?.className).toBe(
			"article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden",
		);
	});

	it("tells a reader of a deleted page that it is gone, and pitches no capture that could not bring it back", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "failed",
					outcomeRevision: 1,
					reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }),
				},
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
				extensionInstallUrl: "/install?client=chrome",
			}),
		);

		expect(doc.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(
			"This page no longer appears to exist, so Readplace couldn't retrieve the article content.",
		);
		const pitch = doc.querySelector(".article-body__reader-notice-pitch");
		assert(pitch, "the capture pitch wrapper must be rendered");
		expect(pitch.className).toBe("article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden");
	});

	it("routes status=unsupported to the unsupported variant with the reassuring title", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "unsupported",
					reason: "non-html content type: application/pdf",
				},
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("unsupported");
		expect(slot.getAttribute("hx-get")).toBeNull();
		assert.equal(
			doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim(),
			"Your link is saved",
		);
	});

	it("routes status=ready with content to the ready component", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				content: articleBody("<p>Body copy</p>"),
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
		const content = slot.querySelector("[data-test-reader-content]");
		assert(content, "ready slot must wrap the body in the content element");
		expect(content.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("renders pending when crawl status is missing, no content, and a poll URL exists (read-after-write race)", () => {
		const doc = parse(
			renderReaderSlot({
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(readerProgressTrack(doc).getAttribute("aria-valuenow")).toBe("8");
	});

	it("renders the 'slow' reframe when crawl status is missing and there is no poll URL left", () => {
		const doc = parse(renderReaderSlot({ url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
	});

	it("treats a legacy row (no crawl status) with content as ready", () => {
		const doc = parse(
			renderReaderSlot({
				content: articleBody("<p>Legacy body</p>"),
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
	});

	it("renders pending when crawl is ready but content is missing and a poll URL exists (worker-bug catch-all)", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(readerProgressTrack(doc).getAttribute("aria-valuenow")).toBe("90");
	});

	it("renders the 'slow' reframe when crawl is ready but content is missing and the poll cap has exhausted", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				url: URL,
				articleId: ARTICLE_ID,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
	});

	it("stamps the tapped kick-off URL on the blocked notice's capture control and the automatic one on the notice, even though a failed crawl has no live poll URL", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "failed",
					outcomeRevision: 1,
					reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
				},
				url: URL,
				articleId: ARTICLE_ID,
				capturePollUrls: CAPTURE_POLL_URLS,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("hx-get")).toBeNull();
		expect({
			manual: doc.querySelector("[data-test-reader-notice] [data-reader-capture]")?.getAttribute("data-reader-capture-poll"),
			automatic: doc.querySelector("[data-test-reader-notice]")?.getAttribute("hx-get"),
		}).toEqual(CAPTURE_POLL_URLS);
	});

	it("swaps the blocked notice for the capturing pending state while an on-device capture is in flight", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "failed",
					outcomeRevision: 1,
					reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
				},
				url: URL,
				articleId: ARTICLE_ID,
				capture: {
					kind: "copying",
					pollUrl: "/queue/abc/reader?poll=2&captureSince=1",
					gaveUpUrl: "/queue/abc/reader?poll=2&captureSince=1&captureGaveUp=1",
				},
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=2&captureSince=1");
		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the notice region must be rendered");
		expect({
			hxGet: notice.getAttribute("hx-get"),
			hxTrigger: notice.getAttribute("hx-trigger"),
			hxTarget: notice.getAttribute("hx-target"),
			hxSwap: notice.getAttribute("hx-swap"),
			backgroundRequest: notice.hasAttribute("data-background-request"),
		}).toEqual({
			hxGet: "/queue/abc/reader?poll=2&captureSince=1&captureGaveUp=1",
			hxTrigger: "readplace-capture-failed from:document",
			hxTarget: "#article-body-reader-slot",
			hxSwap: "outerHTML show:none",
			backgroundRequest: true,
		});
		expect(slot.querySelector("[data-test-reader-pending-title]")?.textContent).toBe(
			"Copying the page from your device",
		);
		const bar = slot.querySelector('[data-test-progress-bar="reader"]');
		assert(bar, "the reader progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--hidden")).toBe(true);
	});

	it("says the copy never arrived, in place of the blocked notice, when a capture produced nothing", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: {
					status: "failed",
					outcomeRevision: 1,
					reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
				},
				url: URL,
				articleId: ARTICLE_ID,
				capture: { kind: "missing" },
				capturePollUrls: CAPTURE_POLL_URLS,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("capture-missing");
		expect(slot.getAttribute("hx-get")).toBeNull();
		const capture = noticeCaptureControl(doc);
		expect({
			offered: capture.classList.contains("article-body__reader-notice-capture--offered"),
			pollUrl: capture.getAttribute("data-reader-capture-poll"),
		}).toEqual({ offered: true, pollUrl: CAPTURE_POLL_URLS.manual });
	});

	it("renders the healed article once the capture lands, so the poll fragment stops carrying hx-get", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "ready" },
				content: articleBody("<p>Captured body</p>"),
				url: URL,
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=3&captureSince=1",
				capture: { kind: "copying", pollUrl: "/queue/abc/reader?poll=3&captureSince=1", gaveUpUrl: "/g" },
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
		expect(slot.getAttribute("hx-get")).toBeNull();
	});

	it("offers the capture on a crawl that failed to parse, stamped with the kick-off URL", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "parse-error", detail: "no readable article candidate: judge answered none" }) },
				url: URL,
				articleId: ARTICLE_ID,
				capturePollUrls: CAPTURE_POLL_URLS,
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		const capture = noticeCaptureControl(doc);
		expect({
			offered: capture.classList.contains("article-body__reader-notice-capture--offered"),
			pollUrl: capture.getAttribute("data-reader-capture-poll"),
		}).toEqual({ offered: true, pollUrl: CAPTURE_POLL_URLS.manual });
	});

	it.each<{ state: string; input: Omit<ReaderSlotInput, "url" | "articleId" | "appOrigin" | "noticeOob" | "now">; status: string }>([
		{
			state: "a deleted page",
			input: { crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }) } },
			status: "not-found",
		},
		{
			state: "an unreachable origin",
			input: { crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "origin-unreachable", httpStatus: 522 }) } },
			status: "origin-down",
		},
		{
			state: "an unsupported page",
			input: { crawl: { status: "unsupported", reason: "non-html content type: application/pdf" } },
			status: "unsupported",
		},
		{
			state: "a link that is not an article",
			input: { notice: "not-an-article", crawl: { status: "ready" }, content: articleBody("<p>x</p>") },
			status: "not-an-article",
		},
		{
			state: "a crawl past the poll cap",
			input: { crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } },
			status: "slow",
		},
	])("renders the capture control withheld on $state, which no device can rescue", ({ input, status }) => {
		const doc = parse(renderReaderSlot({ ...input, url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect({
			status: slot.getAttribute("data-reader-status"),
			withheld: noticeCaptureControl(doc).classList.contains("article-body__reader-notice-capture--withheld"),
		}).toEqual({ status, withheld: true });
	});

	it("swaps a failed notice for the capturing pending state while an on-device capture is in flight", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "parse-error", detail: "no readable article candidate: judge answered none" }) },
				url: URL,
				articleId: ARTICLE_ID,
				capture: { kind: "copying", pollUrl: "/queue/abc/reader?poll=2&captureSince=1", gaveUpUrl: "/g" },
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect({
			status: slot.getAttribute("data-reader-status"),
			hxGet: slot.getAttribute("hx-get"),
			title: slot.querySelector("[data-test-reader-pending-title]")?.textContent,
		}).toEqual({
			status: "pending",
			hxGet: "/queue/abc/reader?poll=2&captureSince=1",
			title: "Copying the page from your device",
		});
	});

	it("offers the capture again on the copy-never-arrived notice", () => {
		const doc = parse(
			renderReaderSlot({
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "parse-error", detail: "no readable article candidate: judge answered none" }) },
				url: URL,
				articleId: ARTICLE_ID,
				capture: { kind: "missing" },
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		const capture = noticeCaptureControl(doc);
		expect({
			status: slot.getAttribute("data-reader-status"),
			hxGet: slot.getAttribute("hx-get"),
			offered: capture.classList.contains("article-body__reader-notice-capture--offered"),
			disabled: capture.hasAttribute("disabled"),
		}).toEqual({ status: "capture-missing", hxGet: null, offered: true, disabled: false });
	});

	it("renders the notice in place of stored content, so a ready crawl on a gated host still shows it", () => {
		const doc = parse(
			renderReaderSlot({
				notice: "not-an-article",
				crawl: { status: "ready" },
				content: articleBody("<p>Inbox (42) — someone@example.com</p>"),
				url: destinationUrl("https://mail.google.com/mail/u/0/"),
				articleId: ARTICLE_ID,
				readerPollUrl: "/queue/abc/reader?poll=1",
				appOrigin: APP_ORIGIN,
				noticeOob: false,
				now: NOW,
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("not-an-article");
		expect(slot.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelector("[data-test-reader-notice]")?.textContent).toContain(
			"This link isn't an article",
		);
	});

	it.each<{
		state: string;
		input: Omit<ReaderSlotInput, "url" | "articleId" | "appOrigin" | "noticeOob" | "now">;
		slot: { status: string; stateClass: string };
		notice: { status: string; stateClass: string };
	}>([
		{
			state: "ready",
			input: { crawl: { status: "ready" }, content: articleBody("<p>x</p>") },
			slot: { status: "ready", stateClass: "article-body__reader-slot--ready" },
			notice: { status: "none", stateClass: "article-body__reader-notice--hidden" },
		},
		{
			state: "legacy row with content",
			input: { content: articleBody("<p>x</p>") },
			slot: { status: "ready", stateClass: "article-body__reader-slot--ready" },
			notice: { status: "none", stateClass: "article-body__reader-notice--hidden" },
		},
		{
			state: "pending",
			input: { crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" }, readerPollUrl: "/p" },
			slot: { status: "pending", stateClass: "article-body__reader-slot--pending" },
			notice: { status: "none", stateClass: "article-body__reader-notice--hidden" },
		},
		{
			state: "ready without content, still polling",
			input: { crawl: { status: "ready" }, readerPollUrl: "/p" },
			slot: { status: "pending", stateClass: "article-body__reader-slot--pending" },
			notice: { status: "none", stateClass: "article-body__reader-notice--hidden" },
		},
		{
			state: "pending past the poll cap",
			input: { crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" } },
			slot: { status: "slow", stateClass: "article-body__reader-slot--notice" },
			notice: { status: "slow", stateClass: "article-body__reader-notice--visible" },
		},
		{
			state: "failed",
			input: { crawl: { status: "failed", outcomeRevision: 1, reason: "x" } },
			slot: { status: "failed", stateClass: "article-body__reader-slot--notice" },
			notice: { status: "failed", stateClass: "article-body__reader-notice--visible" },
		},
		{
			state: "unsupported",
			input: { crawl: { status: "unsupported", reason: "x" } },
			slot: { status: "unsupported", stateClass: "article-body__reader-slot--notice" },
			notice: { status: "unsupported", stateClass: "article-body__reader-notice--visible" },
		},
		{
			state: "capturing on the device",
			input: {
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
				capture: { kind: "copying", pollUrl: "/p", gaveUpUrl: "/g" },
			},
			slot: { status: "pending", stateClass: "article-body__reader-slot--pending" },
			notice: { status: "none", stateClass: "article-body__reader-notice--hidden" },
		},
		{
			state: "a capture that never arrived",
			input: {
				crawl: { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
				capture: { kind: "missing" },
			},
			slot: { status: "capture-missing", stateClass: "article-body__reader-slot--notice" },
			notice: { status: "capture-missing", stateClass: "article-body__reader-notice--visible" },
		},
		{
			state: "a notice override on a ready crawl",
			input: { notice: "not-an-article", crawl: { status: "ready" }, content: articleBody("<p>x</p>") },
			slot: { status: "not-an-article", stateClass: "article-body__reader-slot--notice" },
			notice: { status: "not-an-article", stateClass: "article-body__reader-notice--visible" },
		},
	])("pairs the $state slot with the notice region it needs", ({ input, slot, notice }) => {
		const doc = parse(renderReaderSlot({ ...input, url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }));

		const slotElement = doc.querySelector("[data-test-reader-slot]");
		assert(slotElement, "reader slot must be rendered");
		const noticeElement = doc.querySelector("[data-test-reader-notice]");
		assert(noticeElement, "notice region must be rendered");
		expect({
			slotStatus: slotElement.getAttribute("data-reader-status"),
			slotInState: slotElement.classList.contains(slot.stateClass),
			noticeStatus: noticeElement.getAttribute("data-reader-status"),
			noticeInState: noticeElement.classList.contains(notice.stateClass),
		}).toEqual({
			slotStatus: slot.status,
			slotInState: true,
			noticeStatus: notice.status,
			noticeInState: true,
		});
	});

	it.each([
		{ state: "pending", crawl: { status: "pending" as const, startedAt: "2026-11-05T10:00:00.000Z" }, readerPollUrl: "/p" },
		{ state: "failed", crawl: { status: "failed" as const, reason: "x", outcomeRevision: 1 }, readerPollUrl: undefined },
	])("marks the $state slot and its notice out of band independently", ({ crawl, readerPollUrl }) => {
		const swaps = [
			{ oob: false, noticeOob: false, now: NOW },
			{ oob: true, noticeOob: false, now: NOW },
			{ oob: false, noticeOob: true },
			{ oob: true, noticeOob: true },
		].map(({ oob, noticeOob }) => {
			const doc = parse(
				renderReaderSlot({ crawl, readerPollUrl, url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, oob, noticeOob, now: NOW }),
			);
			const slotElement = doc.querySelector("[data-test-reader-slot]");
			assert(slotElement, "reader slot must be rendered");
			const noticeElement = doc.querySelector("[data-test-reader-notice]");
			assert(noticeElement, "notice region must be rendered");
			return [slotElement.getAttribute("hx-swap-oob"), noticeElement.getAttribute("hx-swap-oob")];
		});

		expect(swaps).toEqual([
			[null, null],
			["outerHTML", null],
			[null, "outerHTML"],
			["outerHTML", "outerHTML"],
		]);
	});

	it("dispatches every CrawlStatus variant — adding a new variant must break this test (and the renderer's exhaustive switch)", () => {
		const variants: Array<{
			input: Parameters<typeof renderReaderSlot>[0];
			expected: string;
		}> = [
			{ input: { crawl: { status: "ready" }, content: articleBody("<p>x</p>"), url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }, expected: "ready" },
			{ input: { crawl: { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" }, url: URL, articleId: ARTICLE_ID, readerPollUrl: "/p", appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }, expected: "pending" },
			{ input: { crawl: { status: "failed", outcomeRevision: 1, reason: "x" }, url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }, expected: "failed" },
			{ input: { crawl: { status: "unsupported", reason: "x" }, url: URL, articleId: ARTICLE_ID, appOrigin: APP_ORIGIN, noticeOob: false, now: NOW }, expected: "unsupported" },
		];

		for (const { input, expected } of variants) {
			const doc = parse(renderReaderSlot(input));
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, `slot must render for status=${expected}`);
			expect(slot.getAttribute("data-reader-status")).toBe(expected);
		}
	});
});
