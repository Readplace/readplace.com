import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type ActionButtons,
	ChromelessReader,
	RegularReader,
} from "./reader-actions.component";

const BACK = {
	topHref: "/queue?utm_content=back-top",
	bottomHref: "/queue?utm_content=back-bottom",
	label: "← Back to queue",
};

const ACTION_BTNS: ActionButtons = {
	backLink: BACK,
	markReadActions: [
		{
			position: "top",
			postUrl: "/queue/abc/status?utm_content=mark-read-top",
			label: "Mark as read",
			fields: [{ name: "status", value: "read" }],
		},
		{
			position: "bottom",
			postUrl: "/queue/abc/status?utm_content=mark-read-bottom",
			label: "Mark as read",
			fields: [{ name: "status", value: "read" }],
		},
	],
};

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

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

		expect(bottomDoc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe(
			BACK.bottomHref,
		);
		const bottomForm = bottomDoc.querySelector("[data-test-mark-read-bottom-form]");
		assert(bottomForm, "bottom mark-read form must render");
		expect(bottomForm.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-bottom");
	});

	it("renders hidden slots when given no action buttons (ViewPage/AdminRecrawl parity)", () => {
		const { top, bottom } = RegularReader({ actionBtns: {} });
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

	it("keeps the bottom back link but drops the bottom mark-read", () => {
		const { bottom } = ChromelessReader({ actionBtns: ACTION_BTNS });
		const bottomDoc = parse(bottom.to("text/html").body);

		expect(bottomDoc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe(
			BACK.bottomHref,
		);
		expect(
			bottomDoc
				.querySelector("[data-test-mark-read-bottom-slot]")
				?.classList.contains("article-body__mark-read-slot--hidden"),
		).toBe(true);
	});

	it("carries the chromeless body class so the reader CSS offsets content below the sticky toolbar", () => {
		expect(ChromelessReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe(
			"page-reader page-reader--chromeless",
		);
	});
});
