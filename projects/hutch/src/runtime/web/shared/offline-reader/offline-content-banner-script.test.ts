import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { offlineContentBannerScript } from "./offline-content-banner-script";

const LIST_URL = "https://readplace.com/queue";
const READER_URL = "https://readplace.com/queue/abc123/view?v=token";
const BANNERS = (kind: "list" | "reader") =>
	`<p hidden data-offline-content-banner="${kind}" data-offline-content-state="processing">Open online.</p><p hidden data-offline-content-banner="${kind}" data-offline-content-state="unavailable">No content.</p>`;
const LIST_BANNER = BANNERS("list");
const READER_BANNER = BANNERS("reader");

function card(state: string): string {
	return `<article class="readlist-article" data-content-state="${state}"><a class="readlist-article__title" href="/queue/a/view">T</a></article>`;
}

function openPage(input: { url: string; main: string; storedPath?: string }) {
	const copy = input.storedPath === undefined ? "" : ` data-offline-copy-path="${input.storedPath}" data-offline-copy-saved-at="2026-11-08T00:00:00.000Z"`;
	const dom = new JSDOM(
		`<!DOCTYPE html><html${copy}><body>${input.main}${offlineContentBannerScript(generateCspNonce())}</body></html>`,
		{ url: input.url, runScripts: "dangerously" },
	);
	const { document } = dom.window;
	return {
		document,
		window: dom.window,
		shown(kind: "list" | "reader"): string[] {
			return Array.from(
				document.querySelectorAll<HTMLElement>(`[data-offline-content-banner="${kind}"]:not([hidden])`),
				(banner) => String(banner.getAttribute("data-offline-content-state")),
			);
		},
	};
}

describe("offlineContentBannerScript", () => {
	it.each(["processing", "unavailable"])("shows only the %s list banner on a stored list that holds such a card", (state) => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("available")}${card(state)}</main>` });

		expect(page.shown("list")).toEqual([state]);
	});

	it("shows both list banners on a stored list that holds a processing and an unavailable card", () => {
		const page = openPage({
			url: LIST_URL,
			storedPath: "/queue",
			main: `<main>${LIST_BANNER}${card("processing")}${card("unavailable")}</main>`,
		});

		expect(page.shown("list")).toEqual(["processing", "unavailable"]);
	});

	it("keeps the list banner hidden on a stored list whose cards are all available", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("available")}</main>` });

		expect(page.shown("list")).toEqual([]);
	});

	it("keeps the list banner hidden when the stored copy on record is another page's", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue/abc123/view", main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });

		expect(page.shown("list")).toEqual([]);
	});

	it.each(["processing", "unavailable"])("shows only the %s reader banner on a stored reader page in that state", (state) => {
		const page = openPage({
			url: READER_URL,
			storedPath: "/queue/abc123/view",
			main: `<main class="reader" data-content-state="${state}">${READER_BANNER}</main>`,
		});

		expect(page.shown("reader")).toEqual([state]);
	});

	it("keeps the reader banner hidden on a live reader page that is still processing", () => {
		const page = openPage({ url: READER_URL, main: `<main class="reader" data-content-state="processing">${READER_BANNER}</main>` });

		expect(page.shown("reader")).toEqual([]);
	});

	it("keeps the reader banner hidden on a stored reader page whose article is available", () => {
		const page = openPage({
			url: READER_URL,
			storedPath: "/queue/abc123/view",
			main: `<main class="reader" data-content-state="available">${READER_BANNER}</main>`,
		});

		expect(page.shown("reader")).toEqual([]);
	});

	it("shows the banner once the worker marks the page as a stored copy after it rendered", async () => {
		const page = openPage({ url: LIST_URL, main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });
		page.document.documentElement.setAttribute("data-offline-copy-path", "/queue");
		await new Promise((resolve) => setImmediate(resolve));

		expect(page.shown("list")).toEqual(["unavailable"]);
	});

	it("checks again after htmx swaps in a new main", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });
		const main = page.document.querySelector("main");
		assert(main, "main must be on the page");
		main.outerHTML = `<main>${LIST_BANNER}${card("available")}</main>`;
		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));

		expect(page.shown("list")).toEqual([]);
	});
});
