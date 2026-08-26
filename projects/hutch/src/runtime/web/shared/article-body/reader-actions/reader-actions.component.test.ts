import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { QueueSlugSchema } from "@packages/domain/queue";
import {
	type ActionButtons,
	ChromelessReader,
	RegularReader,
	StickyReader,
} from "./reader-actions.component";

const BACK = {
	topHref: "/queue?utm_content=back-top",
	bottomHref: "/queue?utm_content=back-bottom",
	label: "Back to queue",
};

const ACTION_BTNS: ActionButtons = {
	queuePicker: undefined,
	backLink: BACK,
	markReadActions: [
		{
			position: "top",
			postUrl: "/queue/abc/status?utm_content=mark-read-top",
			label: "Mark as read",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
		},
		{
			position: "bottom",
			postUrl: "/queue/abc/status?utm_content=mark-read-bottom",
			label: "Mark as read",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
		},
	],
};

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("queue picker", () => {
	it("renders one assign form per offered queue inside an anchored disclosure", () => {
		const { top } = StickyReader({
			actionBtns: {
				...ACTION_BTNS,
				queuePicker: {
					assignUrl: "/queue/abc/assign",
					returnTo: "/queue/abc/view",
					options: [
						{ slug: QueueSlugSchema.parse("work"), label: "Work" },
						{ slug: QueueSlugSchema.parse("later"), label: "Later" },
					],
				},
			},
		});
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-queues-slot]");
		assert(slot, "the queues slot must render");
		expect(slot.classList.contains("article-body__queues-slot--visible")).toBe(true);
		assert(doc.querySelector("[data-test-queues-trigger]"), "the trigger must render");
		const forms = Array.from(doc.querySelectorAll(".article-body__queues-form"));
		expect(forms.map((form) => form.getAttribute("action"))).toEqual([
			"/queue/abc/assign",
			"/queue/abc/assign",
		]);
		expect(
			forms.map((form) => form.querySelector('input[name="queue"]')?.getAttribute("value")),
		).toEqual(["work", "later"]);
		expect(
			forms.map((form) => form.querySelector('input[name="returnTo"]')?.getAttribute("value")),
		).toEqual(["/queue/abc/view", "/queue/abc/view"]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-assign-queue]"), (el) => el.textContent),
		).toEqual(["Work", "Later"]);
	});

	it("keeps the slot in the bar, hidden, when there is nothing to offer", () => {
		const { top } = StickyReader({ actionBtns: ACTION_BTNS });
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-queues-slot]");
		assert(slot, "the queues slot must render");
		expect(slot.classList.contains("article-body__queues-slot--hidden")).toBe(true);
	});
});

describe("mark-read confirmation", () => {
	it("keeps one plain form, holding the action's own test hook, when nothing needs confirming", () => {
		const { top } = StickyReader({ actionBtns: ACTION_BTNS });
		const doc = parse(top.to("text/html").body);

		const button = doc.querySelector("[data-test-mark-read-btn]");
		assert(button, "the mark-read button must render");
		expect(button.getAttribute("data-test-action")).toBe("mark-read");
		expect(button.getAttribute("type")).toBe("submit");
		expect(doc.querySelectorAll(".article-body__confirm-trigger")).toHaveLength(0);
		expect(doc.querySelectorAll(".article-body__mark-read-fallback")).toHaveLength(0);
	});

	it("splits into a popover trigger and a renamed fallback once the action is confirmed", () => {
		const { top } = StickyReader({
			actionBtns: {
				...ACTION_BTNS,
				markReadActions: [
					{
						position: "top",
						postUrl: "/queue/abc/status?utm_content=mark-read-top",
						label: "Mark as read",
						testAction: "mark-read",
						fields: [{ name: "status", value: "read" }],
						confirmPopoverId: "queue-mark-status-confirm-abc",
					},
				],
			},
		});
		const doc = parse(top.to("text/html").body);

		const trigger = doc.querySelector(".article-body__confirm-trigger");
		assert(trigger, "the popover trigger must render");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("queue-mark-status-confirm-abc");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("data-test-action")).toBe("mark-read");
		expect(trigger.getAttribute("aria-label")).toBe("Mark as read");
		expect(trigger.closest("form")).toBeNull();

		const fallback = doc.querySelector("[data-test-mark-read-btn]");
		assert(fallback, "the plain form must stay behind for browsers without popover support");
		expect(fallback.getAttribute("data-test-action")).toBe("mark-read-fallback");
		expect(fallback.closest("form")?.classList.contains("article-body__mark-read-fallback")).toBe(
			true,
		);
	});
});

describe("RegularReader", () => {
	it("renders inline top and bottom bars with back links and mark-read forms", () => {
		const { top, bottom } = RegularReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);
		const bottomDoc = parse(bottom.to("text/html").body);

		assert(topDoc.querySelector(".article-body__actions--top"), "top bar must render");
		expect(topDoc.querySelector(".article-body__actions--sticky")).toBe(null);

		const backSlot = topDoc.querySelector("[data-test-back-slot]");
		assert(backSlot, "top back slot must render");
		expect(backSlot.classList.contains("article-body__back-slot--visible")).toBe(true);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);

		const form = topDoc.querySelector("[data-test-mark-read-form]");
		assert(form, "top mark-read form must render");
		expect(form.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-top");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");

		// In flight the visible label is visibility:hidden (dropped from the a11y
		// tree) and the loader is aria-hidden, so aria-label keeps the button named
		// while it is disabled — parity with the queue and toast mark-read controls.
		expect(topDoc.querySelector("[data-test-mark-read-btn]")?.getAttribute("aria-label")).toBe(
			"Mark as read",
		);
		expect(
			bottomDoc.querySelector("[data-test-mark-read-bottom-btn]")?.getAttribute("aria-label"),
		).toBe("Mark as read");

		expect(bottomDoc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe(
			BACK.bottomHref,
		);
		const bottomForm = bottomDoc.querySelector("[data-test-mark-read-bottom-form]");
		assert(bottomForm, "bottom mark-read form must render");
		expect(bottomForm.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-bottom");
	});

	it("renders hidden slots when given no action buttons (ViewPage/AdminRecrawl parity)", () => {
		const { top, bottom } = RegularReader({ actionBtns: { queuePicker: undefined } });
		const topDoc = parse(top.to("text/html").body);
		const bottomDoc = parse(bottom.to("text/html").body);

		expect(
			topDoc.querySelector("[data-test-back-slot]")?.classList.contains("article-body__back-slot--hidden"),
		).toBe(true);
		expect(
			topDoc
				.querySelector("[data-test-mark-read-slot]")
				?.classList.contains("article-body__mark-read-slot--hidden"),
		).toBe(true);
		expect(
			bottomDoc
				.querySelector("[data-test-back-bottom-slot]")
				?.classList.contains("article-body__back-bottom-slot--hidden"),
		).toBe(true);
		expect(
			bottomDoc
				.querySelector("[data-test-mark-read-bottom-slot]")
				?.classList.contains("article-body__mark-read-slot--hidden"),
		).toBe(true);
	});

	it("carries the standard page body class (no chromeless offset)", () => {
		expect(RegularReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe("page-reader");
	});
});

describe("StickyReader", () => {
	it("places the top action buttons inside a sticky container, keeping the mark-read form", () => {
		const { top } = StickyReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);

		const sticky = topDoc.querySelector(".article-body__actions--sticky");
		assert(sticky, "sticky container must wrap the top action buttons");
		assert(
			sticky.querySelector(".article-body__actions--top"),
			"the top action bar must live inside the sticky container",
		);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);
		assert(topDoc.querySelector("[data-test-mark-read-form]"), "the web reader keeps the top mark-read form");
	});

	it("drops the entire bottom bar — the sticky top bar stays reachable while scrolling", () => {
		const { bottom } = StickyReader({ actionBtns: ACTION_BTNS });
		expect(bottom.to("text/html").body).toBe("");
	});

	it("carries the standard page body class so the toolbar pins below the web header", () => {
		expect(StickyReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe("page-reader");
	});
});

describe("ChromelessReader", () => {
	it("places the top action buttons inside a sticky container, keeping the mark-read form", () => {
		const { top } = ChromelessReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);

		const sticky = topDoc.querySelector(".article-body__actions--sticky");
		assert(sticky, "sticky container must wrap the top action buttons");
		assert(
			sticky.querySelector(".article-body__actions--top"),
			"the top action bar must live inside the sticky container",
		);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);
		assert(topDoc.querySelector("[data-test-mark-read-form]"), "chromeless keeps the top mark-read form");
	});

	it("drops the entire bottom bar — the native sheet handles dismissal", () => {
		const { bottom } = ChromelessReader({ actionBtns: ACTION_BTNS });
		expect(bottom.to("text/html").body).toBe("");
	});

	it("carries the chromeless body class so the reader CSS offsets content below the sticky toolbar", () => {
		expect(ChromelessReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe(
			"page-reader page-reader--chromeless",
		);
	});
});
