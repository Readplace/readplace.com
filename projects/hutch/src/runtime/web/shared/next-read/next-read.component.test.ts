import assert from "node:assert/strict";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { RelatedArticleDisplay } from "@packages/provider-contracts/related-articles";
import { JSDOM } from "jsdom";
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
const savedDaysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function readyWith(items: RelatedArticleDisplay[], pollUrl?: string) {
	return renderNextRead({
		related: {
			articles: { status: "ready", items },
			sourceArticleId: sourceId.value,
			now: NOW,
		},
		pollUrl,
		returnTo: RETURN_TO,
	});
}

const FIRST: RelatedArticleDisplay = {
	id: firstId,
	title: "First",
	siteName: "Example",
	reason: "Same argument",
	status: "unread",
	savedAt: savedDaysAgo(60),
};

const SECOND: RelatedArticleDisplay = {
	id: secondId,
	title: "Second",
	siteName: "Other",
	reason: "Follow-up",
	status: "unread",
	savedAt: savedDaysAgo(7),
};

const FINISHED: RelatedArticleDisplay = {
	id: secondId,
	title: "Finished",
	siteName: "Other",
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

describe("renderNextRead", () => {
	it("returns only the slot HTML (no outer page)", () => {
		const html = renderNextRead({ returnTo: RETURN_TO });

		expect(html.startsWith("<div")).toBe(true);
		expect(html.includes("<html")).toBe(false);
	});

	it("hides the card while nothing has been computed", () => {
		const slot = slotOf(parse(renderNextRead({ returnTo: RETURN_TO })));

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
					},
					returnTo: RETURN_TO,
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
		const doc = parse(readyWith([FIRST]));

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			href: link.getAttribute("href"),
			title: link.querySelector(".next-read__title")?.textContent,
			siteName: link.querySelector(".next-read__site")?.textContent,
			reason: link.querySelector(".next-read__reason")?.textContent,
			saved: link.querySelector(".next-read__saved")?.textContent,
			eyebrow: link.querySelector(".next-read__eyebrow")?.textContent,
		}).toEqual({
			href: `/queue/${firstId.value}/view?utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${sourceId.value}`,
			title: "First",
			siteName: "Example",
			reason: "Same argument",
			saved: "You saved this 2 months ago",
			eyebrow: "Next read",
		});
	});

	it("badges an unread suggestion as unread", () => {
		const doc = parse(readyWith([FIRST]));

		const badge = doc.querySelector(".next-read__status");
		assert(badge, "the suggestion carries its read state");
		const label = badge.querySelector(".next-read__status-label");
		assert(label, "a read state names itself in words, not only by its shape");
		expect({
			state: badge.getAttribute("data-test-read-status"),
			unread: badge.classList.contains("next-read__status--unread"),
			label: label.textContent,
		}).toEqual({ state: "unread", unread: true, label: "Unread" });
	});

	it("offers the unread relation ahead of one the reader has already finished", () => {
		const doc = parse(readyWith([FINISHED, FIRST]));

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			id: link.getAttribute("data-test-related-item"),
			eyebrow: link.querySelector(".next-read__eyebrow")?.textContent,
		}).toEqual({ id: firstId.value, eyebrow: "Next read" });
	});

	it("falls back to a past read, dated by when the reader read it, once no relation is unread", () => {
		const doc = parse(readyWith([FINISHED]));

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		const badge = link.querySelector(".next-read__status");
		assert(badge, "the suggestion carries its read state");
		const time = link.querySelector(".next-read__saved time");
		assert(time, "the fallback line must carry a <time> the enhancer can find");
		expect({
			id: link.getAttribute("data-test-related-item"),
			eyebrow: link.querySelector(".next-read__eyebrow")?.textContent,
			state: badge.getAttribute("data-test-read-status"),
			read: badge.classList.contains("next-read__status--read"),
			label: badge.querySelector(".next-read__status-label")?.textContent,
			dated: link.querySelector(".next-read__saved")?.textContent,
			datetime: time.getAttribute("datetime"),
		}).toEqual({
			id: secondId.value,
			eyebrow: "Similar past reads",
			state: "read",
			read: true,
			label: "Read",
			dated: "You read this 5 days ago",
			datetime: FINISHED.readAt?.toISOString(),
		});
	});

	it("dates a past read by when it was saved when the row never recorded a read time", () => {
		const { readAt: _readAt, ...undatedRead } = FINISHED;
		const doc = parse(readyWith([undatedRead]));

		const link = doc.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		expect({
			eyebrow: link.querySelector(".next-read__eyebrow")?.textContent,
			state: link
				.querySelector(".next-read__status")
				?.getAttribute("data-test-read-status"),
			dated: link.querySelector(".next-read__saved")?.textContent,
		}).toEqual({
			eyebrow: "Similar past reads",
			state: "read",
			dated: "You saved this 2 months ago",
		});
	});

	it("reads the unread badge and the saved time as one line", () => {
		const doc = parse(readyWith([FIRST]));

		const meta = doc.querySelector(".next-read__meta");
		assert(meta, "the badge and the saved time must share a row");
		expect(
			Array.from(meta.children).map((child) => child.className),
		).toEqual([
			"next-read__status next-read__status--unread",
			"next-read__saved",
		]);
	});

	it("makes the whole card one link, so every part of it opens the suggestion", () => {
		const doc = parse(readyWith([FIRST]));

		const card = doc.querySelector(".next-read__card");
		assert(card, "a ready slot must render the card");
		const link = card.querySelector("[data-test-related-item]");
		assert(link, "a ready slot must render the suggestion link");
		for (const part of [
			".next-read__eyebrow",
			".next-read__title",
			".next-read__site",
			".next-read__reason",
			".next-read__meta",
		]) {
			assert(link.querySelector(part), `${part} must sit inside the suggestion link`);
		}
		expect(
			Array.from(card.children).map((child) => child.className),
		).toEqual(["next-read__dismiss-form", "next-read__link"]);
	});

	it("marks the saved time up so the client enhancer can localise it into a hover title", () => {
		const doc = parse(readyWith([FIRST]));

		const time = doc.querySelector(".next-read__saved time");
		assert(time, "the saved line must carry a <time> the enhancer can find");
		expect({
			tag: time.tagName,
			datetime: time.getAttribute("datetime"),
			mode: time.getAttribute("data-local-time"),
			text: time.textContent,
		}).toEqual({
			tag: "TIME",
			datetime: FIRST.savedAt.toISOString(),
			mode: "relative",
			text: "2 months ago",
		});
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

	it("boosts the dismissal so the card disappears without losing the reader's place", () => {
		const doc = parse(readyWith([FIRST]));

		const form = doc.querySelector(".next-read__dismiss-form");
		assert(form, "a ready slot must offer a way to dismiss the suggestion");
		expect({
			boost: form.getAttribute("hx-boost"),
			target: form.getAttribute("hx-target"),
			select: form.getAttribute("hx-select"),
			swap: form.getAttribute("hx-swap"),
		}).toEqual({
			boost: "true",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
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

	it("boosts the suggestion so it navigates like the rest of the reader", () => {
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
			swap: "outerHTML show:none",
		});
	});

	it("keeps ticking while the computation is still pending", () => {
		const slot = slotOf(
			parse(
				renderNextRead({
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
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
					},
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
				}),
			),
		);

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("never ticks when the reader was given no poll url", () => {
		const slot = slotOf(parse(renderNextRead({ returnTo: RETURN_TO })));

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("keeps the swap target stable so a poll answer replaces the slot in place", () => {
		const pending = slotOf(
			parse(
				renderNextRead({
					pollUrl: "/queue/abc/related?poll=2",
					returnTo: RETURN_TO,
				}),
			),
		);
		const ready = slotOf(parse(readyWith([FIRST])));

		expect(pending.id).toBe(ready.id);
		expect(ready.id).toBe("article-body-related-slot");
	});
});
