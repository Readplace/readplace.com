import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { toAbsoluteShortDateTime } from "@packages/web-shell/local-time.format";
import { renderCrawlBookmark } from "./crawl-bookmark.component";
import { offlineCopyRowScript } from "./offline-copy-row-script";

const READER_URL = "https://readplace.com/queue/abc123/view?v=token";
const READER_PATH = "/queue/abc123/view";
const COPY_SAVED_AT = "2026-10-04T12:00:00.000Z";
const LATER_SAVED_AT = "2026-10-05T08:30:00.000Z";
const BEST_VERSION_AT = "2026-07-10T09:14:00.000Z";
const OLDER_VERSION_AT = "2026-06-28T22:01:00.000Z";
const ANNOUNCEMENTS = ["readplace:local-time", "readplace:crawl-bookmark"] as const;

const SERVER_DRAWER = renderCrawlBookmark({
	versions: [toAbsoluteShortDateTime({ iso: BEST_VERSION_AT }), toAbsoluteShortDateTime({ iso: OLDER_VERSION_AT })],
});
const SERVER_ROW_KEYS = ["canonical", OLDER_VERSION_AT];

interface StoredCopy {
	path: string;
	savedAt: string;
}

interface Announcement {
	type: (typeof ANNOUNCEMENTS)[number];
	target: Element;
}

function readerMain(drawer: string, options: { busy: boolean } = { busy: false }): string {
	return `<main class="reader"${options.busy ? ' aria-busy="true"' : ""}><div class="reader__article-body" data-article-body><h1>Title</h1>${drawer}<p>Body</p></div></main>`;
}

function openPage(input: { mainHtml: string; url?: string; copy?: StoredCopy }) {
	const announced: Announcement[] = [];
	const { copy } = input;
	const copyAttributes =
		copy === undefined ? "" : ` data-offline-copy-path="${copy.path}" data-offline-copy-saved-at="${copy.savedAt}"`;
	const dom = new JSDOM(
		`<!DOCTYPE html><html${copyAttributes}><body>${input.mainHtml}${offlineCopyRowScript(generateCspNonce())}</body></html>`,
		{
			url: input.url ?? READER_URL,
			runScripts: "dangerously",
			beforeParse(window) {
				for (const type of ANNOUNCEMENTS) {
					window.addEventListener(type, (event) => {
						assert(event.target instanceof window.Element, "an announcement must come from an element");
						announced.push({ type, target: event.target });
					});
				}
			},
		},
	);
	const { document } = dom.window;
	return {
		document,
		window: dom.window,
		announced,
		recordCopy(recorded: StoredCopy): void {
			document.documentElement.setAttribute("data-offline-copy-path", recorded.path);
			document.documentElement.setAttribute("data-offline-copy-saved-at", recorded.savedAt);
		},
		forgetCopy(): void {
			document.documentElement.removeAttribute("data-offline-copy-path");
			document.documentElement.removeAttribute("data-offline-copy-saved-at");
		},
		swapMain(swap: { html: string; pushedUrl?: string }): void {
			if (swap.pushedUrl !== undefined) dom.window.history.pushState({}, "", swap.pushedUrl);
			const main = document.querySelector("main");
			assert(main, "a main must be on screen to swap");
			main.outerHTML = swap.html;
			const swapped = document.querySelector("main");
			assert(swapped, "htmx must swap a main in");
			swapped.dispatchEvent(new dom.window.Event("htmx:afterSwap", { bubbles: true }));
		},
	};
}

function observed(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function pick(within: ParentNode, selector: string): Element {
	const element = within.querySelector(selector);
	assert(element, `${selector} must be rendered`);
	return element;
}

function serverDrawerFor(savedAt: string): Element {
	return pick(JSDOM.fragment(renderCrawlBookmark({ versions: [toAbsoluteShortDateTime({ iso: savedAt })] })), "details");
}

function rowKeys(document: Document): string[] {
	return Array.from(document.querySelectorAll(".crawl-bookmark__tab"), (tab) =>
		String(tab.getAttribute("data-test-crawl-bookmark-tab")),
	);
}

function articleChildren(document: Document): string[] {
	return Array.from(pick(document, "[data-article-body]").children, (child) => child.tagName);
}

function pickOfflineRow(document: Document): Element {
	return pick(document, '[data-test-crawl-bookmark-tab="offline"]');
}

function pickOfflineTime(document: Document): Element {
	return pick(pickOfflineRow(document), "time");
}

describe("offlineCopyRowScript", () => {
	it("runs under the page's CSP nonce", () => {
		const nonce = generateCspNonce();

		const script = new JSDOM(offlineCopyRowScript(nonce)).window.document.querySelector("script");

		expect(script?.getAttribute("nonce")).toBe(nonce);
	});

	it("tops the drawer with a row for the stored copy, built like the server's current row, with an Offline badge in the place of its state badge", () => {
		const { document, announced } = openPage({
			mainHtml: readerMain(SERVER_DRAWER),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		const serverRow = pick(serverDrawerFor(COPY_SAVED_AT), ".crawl-bookmark__tab");
		const row = pickOfflineRow(document);
		const badge = pick(row, '[data-test-crawl-bookmark-badge="offline"]');
		expect(rowKeys(document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
		expect(row.className).toBe(serverRow.className);
		expect(row.getAttribute("aria-disabled")).toBe(serverRow.getAttribute("aria-disabled"));
		expect(pickOfflineTime(document).outerHTML).toBe(pick(serverRow, "time").outerHTML);
		expect(badge.className).toBe(pick(serverRow, '[data-test-crawl-bookmark-badge="state"]').className);
		expect(badge.textContent).toBe("Offline");
		expect(announced).toEqual([{ type: "readplace:local-time", target: pickOfflineTime(document) }]);
	});

	it.each([
		"2026-10-04T12:00:00.000Z",
		"2026-01-09T00:05:00.000Z",
		"2026-12-31T23:59:59.999Z",
		"2027-03-01T07:30:00.000Z",
	])("writes the saved time %s exactly as the server writes a drawer time before the browser localises it", (savedAt) => {
		const { document } = openPage({
			mainHtml: readerMain(SERVER_DRAWER),
			copy: { path: READER_PATH, savedAt },
		});

		expect(pickOfflineTime(document).outerHTML).toBe(pick(serverDrawerFor(savedAt), "time").outerHTML);
	});

	it("adds the row when the shell records a stored copy after the page loaded", async () => {
		const page = openPage({ mainHtml: readerMain(SERVER_DRAWER) });
		expect(rowKeys(page.document)).toEqual(SERVER_ROW_KEYS);

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("adds an open drawer like the server's, holding just that row, when the stored page has no drawer, and tells the drawer's client about it", async () => {
		const page = openPage({ mainHtml: readerMain("") });

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();

		const server = serverDrawerFor(COPY_SAVED_AT);
		const article = pick(page.document, "[data-article-body]");
		const drawer = pick(article, ":scope > details");
		expect(articleChildren(page.document)).toEqual(["H1", "P", "DETAILS"]);
		expect(drawer.className).toBe(server.className);
		expect(drawer.hasAttribute("open")).toBe(server.hasAttribute("open"));
		expect(pick(drawer, ":scope > summary").outerHTML).toBe(pick(server, ":scope > summary").outerHTML);
		expect(pick(drawer, ":scope > ul").className).toBe(pick(server, ":scope > ul").className);
		expect(rowKeys(page.document)).toEqual(["offline"]);
		expect(page.announced).toEqual([
			{ type: "readplace:crawl-bookmark", target: article },
			{ type: "readplace:local-time", target: pickOfflineTime(page.document) },
		]);
	});

	it("takes the row away when the online page replaces the copy, keeping the server's rows", async () => {
		const page = openPage({
			mainHtml: readerMain(SERVER_DRAWER),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		page.forgetCopy();
		await observed();

		expect(rowKeys(page.document)).toEqual(SERVER_ROW_KEYS);
	});

	it("takes away the drawer it added once the copy leaves", async () => {
		const page = openPage({
			mainHtml: readerMain(""),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});
		expect(articleChildren(page.document)).toEqual(["H1", "P", "DETAILS"]);

		page.forgetCopy();
		await observed();

		expect(articleChildren(page.document)).toEqual(["H1", "P"]);
	});

	it("shows no row over the skeleton a card tap paints, then adds it to the article htmx swaps in", () => {
		const page = openPage({
			mainHtml: readerMain("", { busy: true }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});
		expect(articleChildren(page.document)).toEqual(["H1", "P"]);

		page.swapMain({ html: readerMain(SERVER_DRAWER) });

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("waits for htmx to move the address to the article when the worker's message arrives first", async () => {
		const page = openPage({ mainHtml: '<main class="readlist"></main>', url: "https://readplace.com/queue" });

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();
		page.swapMain({ html: readerMain(SERVER_DRAWER), pushedUrl: READER_URL });

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("shows no row for a stored copy of another article", () => {
		const { document } = openPage({
			mainHtml: readerMain(SERVER_DRAWER),
			copy: { path: "/queue/another/view", savedAt: COPY_SAVED_AT },
		});

		expect(rowKeys(document)).toEqual(SERVER_ROW_KEYS);
	});

	it("keeps a single row however often htmx swaps", () => {
		const page = openPage({
			mainHtml: readerMain(SERVER_DRAWER),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));
		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
		expect(page.announced).toHaveLength(1);
	});

	it.each([
		["the server's drawer", SERVER_DRAWER, ["offline", ...SERVER_ROW_KEYS]],
		["the drawer it added", "", ["offline"]],
	])("moves the row in %s to the saved time of the next stored copy the shell records", async (_name, drawer, keys) => {
		const page = openPage({
			mainHtml: readerMain(drawer),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		page.recordCopy({ path: READER_PATH, savedAt: LATER_SAVED_AT });
		await observed();

		expect(rowKeys(page.document)).toEqual(keys);
		expect(pickOfflineTime(page.document).getAttribute("datetime")).toBe(LATER_SAVED_AT);
		expect(page.document.querySelectorAll(".crawl-bookmark")).toHaveLength(1);
	});
});
