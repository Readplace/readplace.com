import assert from "node:assert/strict";
import {
	NEXT_READ_SNOOZE_MS,
	type NextReadDismissal,
	ReaderArticleHashIdSchema,
} from "@packages/domain/article";
import type { RelatedArticleDisplay } from "@packages/provider-contracts/related-articles";
import { JSDOM } from "jsdom";
import { siteLabel } from "../../test-helpers/article-fixtures";
import { renderNextRead } from "./next-read.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

const firstId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const secondId = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const sourceId = ReaderArticleHashIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const NOW = new Date("2026-08-05T12:00:00.000Z");
const RETURN_TO = `/queue/${sourceId.value}/view`;
const WEB_READER_PATH = (articleId: string) => `/queue/${articleId}/view`;
const savedDaysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function readyWith(
	items: RelatedArticleDisplay[],
	pollUrl?: string,
	dismissal?: NextReadDismissal,
	readerPathFor: (articleId: string) => string = WEB_READER_PATH,
) {
	return renderNextRead({
		related: {
			articles: { status: "ready", items },
			sourceArticleId: sourceId.value,
			now: NOW,
			dismissal,
		},
		pollUrl,
		returnTo: RETURN_TO,
		readerPathFor,
	});
}

const dismissedAgo = (ms: number, suggestionId: typeof firstId): NextReadDismissal => ({
	at: new Date(NOW.getTime() - ms),
	suggestionId,
});

const FIRST: RelatedArticleDisplay = {
	id: firstId,
	title: "First",
	siteName: siteLabel("Example"),
	reason: "Same argument",
	status: "unread",
	savedAt: savedDaysAgo(60),
};

const SECOND: RelatedArticleDisplay = {
	id: secondId,
	title: "Second",
	siteName: siteLabel("Other"),
	reason: "Follow-up",
	status: "unread",
	savedAt: savedDaysAgo(7),
};

const FINISHED: RelatedArticleDisplay = {
	id: secondId,
	title: "Finished",
	siteName: siteLabel("Other"),
	reason: "Same field",
	status: "read",
	savedAt: savedDaysAgo(60),
	readAt: savedDaysAgo(5),
};

function slotOf(doc: Document) {
	const slot = doc.querySelector("[data-test-reader-related]");
	assert(slot, "the next-read slot must always be rendered");
	return slot;
}

function cardOf(doc: Document) {
	const card = doc.querySelector(".next-read__card");
	assert(card, "a ready slot must render the card");
	return card;
}

describe("renderNextRead", () => {
	it("returns only the slot HTML (no outer page)", () => {
		const html = renderNextRead({ returnTo: RETURN_TO, readerPathFor: WEB_READER_PATH });

		expect(html.startsWith("<div")).toBe(true);
		expect(html.includes("<html")).toBe(false);
	});

	it("hides the card while nothing has been computed", () => {
		const slot = slotOf(parse(renderNextRead({ returnTo: RETURN_TO, readerPathFor: WEB_READER_PATH })));

		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("hides the card when the computation was skipped", () => {
		const slot = slotOf(
			parse(
				renderNextRead({
					related: {
						articles: { status: "skipped" },
						sourceArticleId: sourceId.value,
						now: NOW,
						dismissal: undefined,
					},
					returnTo: RETURN_TO,
					readerPathFor: WEB_READER_PATH,
				}),
			),
		);

		expect(slot.getAttribute("data-related-status")).toBe("skipped");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("hides the card when the computation found nothing related", () => {
		const slot = slotOf(parse(readyWith([])));

		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("suggests only the first relation, so the reader is offered one next read", () => {
		const doc = parse(readyWith([FIRST, SECOND]));

		const slot = slotOf(doc);
		expect(slot.classList.contains("next-read--ready")).toBe(true);
		expect(
			Array.from(doc.querySelectorAll("[data-test-related-item]")).map((link) =>
				link.getAttribute("data-test-related-item"),
			),
		).toEqual([firstId.value]);
	});

	it("shows the suggestion's title, site, reason and when it was saved", () => {
		const card = cardOf(parse(readyWith([FIRST])));

		const link = card.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			href: link.getAttribute("href"),
			title: card.querySelector(".next-read__title")?.textContent,
			siteName: card.querySelector(".next-read__site")?.textContent,
			reason: card.querySelector(".next-read__reason")?.textContent,
			saved: card.querySelector(".next-read__saved")?.textContent,
			heading: card.querySelector(".next-read__heading")?.textContent,
		}).toEqual({
			href: `/queue/${firstId.value}/view?utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${sourceId.value}`,
			title: "First",
			siteName: siteLabel("Example"),
			reason: "Same argument",
			saved: "You saved this on Jun 6, 2026",
			heading: "Next Read",
		});
	});

	it("keeps the surface markers its caller built into the reader path ahead of the tracking params", () => {
		const doc = parse(
			readyWith([FIRST], undefined, undefined, (articleId) =>
				`/queue/${articleId}/view?platform=ios`,
			),
		);

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect(link.getAttribute("href")).toBe(
			`/queue/${firstId.value}/view?platform=ios&utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${sourceId.value}`,
		);
	});

	it("names the read state in words on the card", () => {
		const card = cardOf(parse(readyWith([FIRST])));

		const status = card.querySelector(".next-read__status");
		assert(status, "the suggestion carries its read state");
		expect({
			state: status.getAttribute("data-test-read-status"),
			label: status.textContent,
			glyph: status.querySelector("svg") !== null,
		}).toEqual({ state: "unread", label: "Unread", glyph: true });
	});

	it("offers the unread relation ahead of one the reader has already finished", () => {
		const card = cardOf(parse(readyWith([FINISHED, FIRST])));

		const link = card.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			id: link.getAttribute("data-test-related-item"),
			heading: card.querySelector(".next-read__heading")?.textContent,
		}).toEqual({ id: firstId.value, heading: "Next Read" });
	});

	it("falls back to a past read, dated by when the reader read it, once no relation is unread", () => {
		const card = cardOf(parse(readyWith([FINISHED])));

		const link = card.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		const status = card.querySelector(".next-read__status");
		assert(status, "the suggestion carries its read state");
		const time = card.querySelector(".next-read__saved time");
		assert(time, "the fallback line must carry a <time> the enhancer can find");
		expect({
			id: link.getAttribute("data-test-related-item"),
			heading: card.querySelector(".next-read__heading")?.textContent,
			state: status.getAttribute("data-test-read-status"),
			label: status.textContent,
			start: link.textContent,
			dated: card.querySelector(".next-read__saved")?.textContent,
			datetime: time.getAttribute("datetime"),
		}).toEqual({
			id: secondId.value,
			heading: "Similar past reads",
			state: "read",
			label: "Read",
			start: "Read again: Finished",
			dated: "You read this 5 days ago",
			datetime: FINISHED.readAt?.toISOString(),
		});
	});

	it("gives both states one anatomy; only the heading, status word and button label change", () => {
		const anatomyOf = (doc: Document) =>
			Array.from(cardOf(doc).querySelectorAll("*"), (element) => element.getAttribute("class"));
		const wordsOf = (doc: Document) => {
			const card = cardOf(doc);
			return {
				heading: card.querySelector(".next-read__heading")?.textContent,
				status: card.querySelector(".next-read__status")?.textContent,
				start: card.querySelector(".next-read__start")?.firstChild?.textContent,
			};
		};
		const unread = parse(readyWith([FIRST]));
		const read = parse(readyWith([FINISHED]));

		expect(anatomyOf(read)).toEqual(anatomyOf(unread));
		expect({ unread: wordsOf(unread), read: wordsOf(read) }).toEqual({
			unread: { heading: "Next Read", status: "Unread", start: "Start reading" },
			read: { heading: "Similar past reads", status: "Read", start: "Read again" },
		});
	});

	it("dates a past read by when it was saved when the row never recorded a read time", () => {
		const { readAt: _readAt, ...undatedRead } = FINISHED;
		const card = cardOf(parse(readyWith([undatedRead])));

		expect({
			heading: card.querySelector(".next-read__heading")?.textContent,
			state: card
				.querySelector(".next-read__status")
				?.getAttribute("data-test-read-status"),
			dated: card.querySelector(".next-read__saved")?.textContent,
		}).toEqual({
			heading: "Similar past reads",
			state: "read",
			dated: "You saved this on Jun 6, 2026",
		});
	});

	it("reads the site, the saved time and the read state as one metadata row", () => {
		const doc = parse(readyWith([FIRST]));

		const meta = doc.querySelector(".next-read__meta");
		assert(meta, "the site, the saved time and the read state must share a row");
		expect(
			Array.from(meta.children).map((child) => child.className),
		).toEqual([
			"next-read__site",
			"next-read__saved",
			"next-read__status",
		]);
	});

	it("offers one link, the Start button, which names the suggestion", () => {
		const card = cardOf(parse(readyWith([FIRST])));

		const links = Array.from(card.querySelectorAll("a[href]"), (link) => ({
			start: link.classList.contains("next-read__start"),
			item: link.getAttribute("data-test-related-item"),
			text: link.textContent,
		}));
		expect(links).toEqual([{ start: true, item: firstId.value, text: "Start reading: First" }]);
		expect(Array.from(card.children, (child) => child.className)).toEqual([
			"next-read__header",
			"next-read__title",
			"next-read__reason",
			"next-read__foot",
		]);
	});

	it("marks the saved time up so the client enhancer can localise it into a hover title", () => {
		const doc = parse(readyWith([SECOND]));

		const time = doc.querySelector(".next-read__saved time");
		assert(time, "the saved line must carry a <time> the enhancer can find");
		expect({
			tag: time.tagName,
			datetime: time.getAttribute("datetime"),
			mode: time.getAttribute("data-local-time"),
			text: time.textContent,
		}).toEqual({
			tag: "TIME",
			datetime: SECOND.savedAt.toISOString(),
			mode: "relative",
			text: "7d ago",
		});
	});

	it("tells a screen reader what a recent saved time dates", () => {
		const card = cardOf(parse(readyWith([SECOND])));

		expect(card.querySelector(".next-read__saved")?.textContent).toBe("You saved this 7d ago");
	});

	it("dates a suggestion saved more than 30 days ago by its calendar day", () => {
		const doc = parse(readyWith([FIRST]));

		const time = doc.querySelector(".next-read__saved time");
		assert(time, "the saved line must carry a <time> the enhancer can find");
		expect({
			datetime: time.getAttribute("datetime"),
			mode: time.getAttribute("data-local-time"),
			text: time.textContent,
		}).toEqual({
			datetime: FIRST.savedAt.toISOString(),
			mode: "date",
			text: "Jun 6, 2026",
		});
	});

	it("hides the card for the rest of the day once the reader dismisses an unread suggestion", () => {
		const slot = slotOf(
			parse(readyWith([FIRST], undefined, dismissedAgo(NEXT_READ_SNOOZE_MS - 1, firstId))),
		);

		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("offers a dismissed unread suggestion again once the day is up", () => {
		const doc = parse(
			readyWith([FIRST], undefined, dismissedAgo(NEXT_READ_SNOOZE_MS, firstId)),
		);

		expect(slotOf(doc).classList.contains("next-read--ready")).toBe(true);
		expect(
			Array.from(doc.querySelectorAll("[data-test-related-item]")).map((link) =>
				link.getAttribute("data-test-related-item"),
			),
		).toEqual([firstId.value]);
	});

	it("keeps a dismissed past read gone however long ago it was waved away", () => {
		const slot = slotOf(
			parse(
				readyWith([FINISHED], undefined, dismissedAgo(NEXT_READ_SNOOZE_MS * 30, secondId)),
			),
		);

		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("names the suggestion in the dismiss form, so the server records which one was waved away", () => {
		const doc = parse(readyWith([FIRST]));

		const form = doc.querySelector(".next-read__dismiss-form");
		assert(form, "a ready slot must offer a way to dismiss the suggestion");
		const suggestionId = form.querySelector('input[name="suggestionId"]');
		assert(suggestionId, "the dismissal must name the suggestion it was aimed at");
		expect(suggestionId.getAttribute("value")).toBe(firstId.value);
	});

	it("dismisses through a POST the analytics middleware counts as a reader click", () => {
		const doc = parse(readyWith([FIRST]));

		const form = doc.querySelector(".next-read__dismiss-form");
		assert(form, "a ready slot must offer a way to dismiss the suggestion");
		const returnTo = form.querySelector('input[name="returnTo"]');
		assert(returnTo, "the dismissal must carry where to return to");
		expect({
			method: form.getAttribute("method"),
			action: form.getAttribute("action"),
			returnTo: returnTo.getAttribute("value"),
		}).toEqual({
			method: "POST",
			action: `/queue/${sourceId.value}/related-dismiss?utm_source=reader&utm_medium=internal&utm_content=next-read-dismiss&utm_term=${sourceId.value}`,
			returnTo: RETURN_TO,
		});
	});

	it("swaps only its own slot, so the article above it is untouched", () => {
		const doc = parse(readyWith([FIRST]));

		const form = doc.querySelector(".next-read__dismiss-form");
		assert(form, "a ready slot must offer a way to dismiss the suggestion");
		expect({
			boost: form.getAttribute("hx-boost"),
			target: form.getAttribute("hx-target"),
			select: form.getAttribute("hx-select"),
			swap: form.getAttribute("hx-swap"),
			pushUrl: form.getAttribute("hx-push-url"),
		}).toEqual({
			boost: "true",
			target: "#article-body-related-slot",
			select: "#article-body-related-slot",
			swap: "outerHTML show:none",
			pushUrl: "false",
		});
	});

	it("labels the dismiss control for screen readers, which cannot see the icon", () => {
		const doc = parse(readyWith([FIRST]));

		const button = doc.querySelector('[data-test-action="next-read-dismiss"]');
		assert(button, "the dismissal must be a submit control");
		expect({
			type: button.getAttribute("type"),
			label: button.querySelector(".sr-only")?.textContent,
			icon: button.querySelector("svg") !== null,
		}).toEqual({ type: "submit", label: "Dismiss suggestion", icon: true });
	});

	it("boosts the suggestion so the next article lands at the top without animation", () => {
		const doc = parse(readyWith([FIRST]));

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			boost: link.getAttribute("hx-boost"),
			target: link.getAttribute("hx-target"),
			select: link.getAttribute("hx-select"),
			swap: link.getAttribute("hx-swap"),
		}).toEqual({
			boost: "true",
			target: "main",
			select: "main",
			swap: "outerHTML show:none scroll:html:top",
		});
	});

	it("keeps ticking while the computation is still pending", () => {
		const slot = slotOf(
			parse(
				renderNextRead({
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
					readerPathFor: WEB_READER_PATH,
				}),
			),
		);

		expect({
			get: slot.getAttribute("hx-get"),
			trigger: slot.getAttribute("hx-trigger"),
			swap: slot.getAttribute("hx-swap"),
		}).toEqual({
			get: "/queue/abc/related?poll=2",
			trigger: "every 3s",
			swap: "outerHTML",
		});
	});

	it("stops ticking once the computation answered, even with nothing related", () => {
		const slot = slotOf(
			parse(readyWith([], "/queue/abc/related?poll=2")),
		);

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("stops ticking once the computation was skipped", () => {
		const slot = slotOf(
			parse(
				renderNextRead({
					related: {
						articles: { status: "skipped" },
						sourceArticleId: sourceId.value,
						now: NOW,
						dismissal: undefined,
					},
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
					readerPathFor: WEB_READER_PATH,
				}),
			),
		);

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("never ticks when the reader was given no poll url", () => {
		const slot = slotOf(parse(renderNextRead({ returnTo: RETURN_TO, readerPathFor: WEB_READER_PATH })));

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("keeps the swap target stable so a poll answer replaces the slot in place", () => {
		const pending = slotOf(
			parse(
				renderNextRead({
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
					readerPathFor: WEB_READER_PATH,
				}),
			),
		);
		const ready = slotOf(parse(readyWith([FIRST])));

		expect(pending.id).toBe(ready.id);
		expect(ready.id).toBe("article-body-related-slot");
	});
});
