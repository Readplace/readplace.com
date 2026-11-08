import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { offlineContentBannerScript } from "./offline-content-banner-script";

const LIST_URL = "https://readplace.com/queue";
const READER_URL = "https://readplace.com/queue/abc123/view?v=token";
const LIST_BANNER = `<p hidden data-offline-content-banner="list">Open them online.</p>`;
const READER_BANNER = `<p hidden data-offline-content-banner="reader">Open it online.</p>`;

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
		hidden(kind: "list" | "reader"): boolean {
			const banner = document.querySelector<HTMLElement>(`[data-offline-content-banner="${kind}"]`);
			assert(banner, `the ${kind} banner must be on the page`);
			return banner.hasAttribute("hidden");
		},
	};
}

describe("offlineContentBannerScript", () => {
	it.each(["processing", "unavailable"])("shows the list banner on a stored list that holds a %s card", (state) => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("available")}${card(state)}</main>` });

		expect(page.hidden("list")).toBe(false);
	});

	it("keeps the list banner hidden on a stored list whose cards are all available", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("available")}</main>` });

		expect(page.hidden("list")).toBe(true);
	});

	it("keeps the list banner hidden when the stored copy on record is another page's", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue/abc123/view", main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });

		expect(page.hidden("list")).toBe(true);
	});

	it("shows the reader banner on a stored reader page whose article is unavailable", () => {
		const page = openPage({
			url: READER_URL,
			storedPath: "/queue/abc123/view",
			main: `<main class="reader" data-content-state="unavailable">${READER_BANNER}</main>`,
		});

		expect(page.hidden("reader")).toBe(false);
	});

	it("keeps the reader banner hidden on a live reader page that is still processing", () => {
		const page = openPage({ url: READER_URL, main: `<main class="reader" data-content-state="processing">${READER_BANNER}</main>` });

		expect(page.hidden("reader")).toBe(true);
	});

	it("keeps the reader banner hidden on a stored reader page whose article is available", () => {
		const page = openPage({
			url: READER_URL,
			storedPath: "/queue/abc123/view",
			main: `<main class="reader" data-content-state="available">${READER_BANNER}</main>`,
		});

		expect(page.hidden("reader")).toBe(true);
	});

	it("shows the banner once the worker marks the page as a stored copy after it rendered", async () => {
		const page = openPage({ url: LIST_URL, main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });
		page.document.documentElement.setAttribute("data-offline-copy-path", "/queue");
		await new Promise((resolve) => setImmediate(resolve));

		expect(page.hidden("list")).toBe(false);
	});

	it("checks again after htmx swaps in a new main", () => {
		const page = openPage({ url: LIST_URL, storedPath: "/queue", main: `<main>${LIST_BANNER}${card("unavailable")}</main>` });
		const main = page.document.querySelector("main");
		assert(main, "main must be on the page");
		main.outerHTML = `<main>${LIST_BANNER}${card("available")}</main>`;
		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));

		expect(page.hidden("list")).toBe(true);
	});
});
