import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { toAbsoluteDate, toAbsoluteTime } from "@packages/web-shell/local-time.format";
import type { ArticleVersion } from "../../article-reader/article-reader.types";
import { renderArticleHistory, renderOfflineCopyTemplate } from "./article-history.component";
import { offlineCopyRowScript } from "./offline-copy-row-script";

const READER_URL = "https://readplace.com/queue/abc123/view?v=token";
const READER_PATH = "/queue/abc123/view";
const COPY_SAVED_AT = "2026-10-04T12:00:00.000Z";
const LATER_SAVED_AT = "2026-10-05T08:30:00.000Z";
const BEST_VERSION_AT = "2026-07-10T09:14:00.000Z";
const OLDER_VERSION_AT = "2026-06-28T22:01:00.000Z";
const ANNOUNCEMENTS = ["readplace:local-time", "readplace:crawl-bookmark"] as const;

function versionAt(iso: string): ArticleVersion {
	return { minuteId: iso, date: toAbsoluteDate({ iso }), time: toAbsoluteTime({ iso }) };
}

const SERVER_CARD = renderArticleHistory({ versions: [versionAt(BEST_VERSION_AT), versionAt(OLDER_VERSION_AT)] });
const SERVER_ROW_KEYS = ["canonical", OLDER_VERSION_AT];
const NO_SERVER_CARD = "";
const COPY_TEMPLATE = renderOfflineCopyTemplate();
const NO_COPY_TEMPLATE = "";

interface StoredCopy {
	path: string;
	savedAt: string;
}

interface Announcement {
	type: (typeof ANNOUNCEMENTS)[number];
	target: Element;
}

function readerMain(
	rail: { card: string; template: string },
	options: { busy: boolean } = { busy: false },
): string {
	return `<main class="reader"${options.busy ? ' aria-busy="true"' : ""}><div class="reading-layout"><div class="reading-layout__main"><div class="reader__article-body" data-article-body><h1>Title</h1><p>Body</p></div></div><div class="reading-layout__rail" data-test-reader-rail>${rail.card}${rail.template}<a class="reading-layout__top" href="#top">Top</a></div></div></main>`;
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

function serverCardFor(savedAt: string): Element {
	return pick(JSDOM.fragment(renderArticleHistory({ versions: [versionAt(savedAt)] })), "details");
}

function serverRowFor(savedAt: string): Element {
	return pick(serverCardFor(savedAt), '[data-test-article-history-version="canonical"]');
}

function rowKeys(document: Document): string[] {
	return Array.from(document.querySelectorAll("[data-test-article-history-version]"), (row) =>
		String(row.getAttribute("data-test-article-history-version")),
	);
}

function railChildren(document: Document): string[] {
	return Array.from(pick(document, "[data-test-reader-rail]").children, (child) => child.tagName);
}

function pickOfflineRow(document: Document): Element {
	return pick(document, '[data-test-article-history-version="offline"]');
}

function stampOf(row: Element, mode: "date" | "time"): { className: string; datetime: string | null; label: string | null } {
	const stamp = pick(row, `time[data-local-time="${mode}"]`);
	return { className: stamp.className, datetime: stamp.getAttribute("datetime"), label: stamp.textContent };
}

describe("offlineCopyRowScript", () => {
	it("runs under the page's CSP nonce", () => {
		const nonce = generateCspNonce();

		const script = new JSDOM(offlineCopyRowScript(nonce)).window.document.querySelector("script");

		expect(script?.getAttribute("nonce")).toBe(nonce);
	});

	it("tops the card's list with a row for the stored copy, built like the server's current row, with an Offline badge in the place of its state badge", () => {
		const { document, announced } = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		const serverRow = serverRowFor(COPY_SAVED_AT);
		const row = pickOfflineRow(document);
		const badge = pick(row, '[data-test-article-history-badge="offline"]');
		expect(rowKeys(document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
		expect(row.className).toBe(serverRow.className);
		expect(row.getAttribute("data-offline-copy-row")).toBe(COPY_SAVED_AT);
		expect(pick(row, ".article-history__marker").outerHTML).toBe(pick(serverRow, ".article-history__marker").outerHTML);
		expect(stampOf(row, "date")).toEqual(stampOf(serverRow, "date"));
		expect(stampOf(row, "time")).toEqual(stampOf(serverRow, "time"));
		expect(pick(row, 'time[data-local-time="date"]').id).toBe("article-history-date-offline");
		expect(badge.className).toBe(pick(serverRow, '[data-test-article-history-badge="state"]').className);
		expect(badge.textContent).toBe("Offline");
		expect(document.querySelectorAll("details[data-test-article-history]")).toHaveLength(1);
		expect(announced).toEqual([{ type: "readplace:local-time", target: row }]);
	});

	it.each([
		{ savedAt: "2026-10-04T12:00:00.000Z", date: "Oct 4, 2026", time: "12:00 PM" },
		{ savedAt: "2026-01-09T00:05:00.000Z", date: "Jan 9, 2026", time: "12:05 AM" },
		{ savedAt: "2026-12-31T23:59:59.999Z", date: "Dec 31, 2026", time: "11:59 PM" },
		{ savedAt: "2027-03-01T07:30:00.000Z", date: "Mar 1, 2027", time: "07:30 AM" },
	])("writes the saved time $savedAt as the date and the time the server writes for a row before the browser localises them", ({ savedAt, date, time }) => {
		const { document } = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt },
		});

		const row = pickOfflineRow(document);
		const serverRow = serverRowFor(savedAt);
		expect(stampOf(row, "date")).toEqual({ className: "article-history__date", datetime: savedAt, label: date });
		expect(stampOf(row, "time")).toEqual({ className: "article-history__time", datetime: savedAt, label: time });
		expect(stampOf(row, "date")).toEqual(stampOf(serverRow, "date"));
		expect(stampOf(row, "time")).toEqual(stampOf(serverRow, "time"));
	});

	it("adds the row when the shell records a stored copy after the page loaded", async () => {
		const page = openPage({ mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }) });
		expect(rowKeys(page.document)).toEqual(SERVER_ROW_KEYS);

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("inserts the template's open card, holding just that row, when the stored page has no card, and announces nothing but the local-time rewrite", async () => {
		const page = openPage({ mainHtml: readerMain({ card: NO_SERVER_CARD, template: COPY_TEMPLATE }) });
		expect(railChildren(page.document)).toEqual(["TEMPLATE", "A"]);

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();

		const server = serverCardFor(COPY_SAVED_AT);
		const card = pick(page.document, "[data-test-reader-rail] > details");
		expect(railChildren(page.document)).toEqual(["DETAILS", "TEMPLATE", "A"]);
		expect(card.className).toBe(server.className);
		expect(card.hasAttribute("open")).toBe(server.hasAttribute("open"));
		expect(card.getAttribute("data-offline-copy-card")).toBe("");
		expect(pick(card, ":scope > summary").outerHTML).toBe(pick(server, ":scope > summary").outerHTML);
		expect(pick(card, ":scope > ol").className).toBe(pick(server, ":scope > ol").className);
		expect(rowKeys(page.document)).toEqual(["offline"]);
		expect(page.announced).toEqual([{ type: "readplace:local-time", target: pickOfflineRow(page.document) }]);
	});

	it("adds no row to a stored page that carries no template, as a copy stored before the card shipped", () => {
		const { document, announced } = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: NO_COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		expect(rowKeys(document)).toEqual(SERVER_ROW_KEYS);
		expect(railChildren(document)).toEqual(["DETAILS", "A"]);
		expect(announced).toEqual([]);
	});

	it("takes the row away when the online page replaces the copy, keeping the server's rows", async () => {
		const page = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});
		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);

		page.forgetCopy();
		await observed();

		expect(rowKeys(page.document)).toEqual(SERVER_ROW_KEYS);
	});

	it("takes away the card it added once the copy leaves", async () => {
		const page = openPage({
			mainHtml: readerMain({ card: NO_SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});
		expect(railChildren(page.document)).toEqual(["DETAILS", "TEMPLATE", "A"]);

		page.forgetCopy();
		await observed();

		expect(railChildren(page.document)).toEqual(["TEMPLATE", "A"]);
	});

	it("shows no row over the skeleton a card tap paints, then adds it to the article htmx swaps in", () => {
		const page = openPage({
			mainHtml: readerMain({ card: NO_SERVER_CARD, template: COPY_TEMPLATE }, { busy: true }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});
		expect(railChildren(page.document)).toEqual(["TEMPLATE", "A"]);

		page.swapMain({ html: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }) });

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("waits for htmx to move the address to the article when the worker's message arrives first", async () => {
		const page = openPage({ mainHtml: '<main class="readlist"></main>', url: "https://readplace.com/queue" });

		page.recordCopy({ path: READER_PATH, savedAt: COPY_SAVED_AT });
		await observed();
		page.swapMain({ html: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }), pushedUrl: READER_URL });

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
	});

	it("shows no row for a stored copy of another article", () => {
		const { document } = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: "/queue/another/view", savedAt: COPY_SAVED_AT },
		});

		expect(rowKeys(document)).toEqual(SERVER_ROW_KEYS);
	});

	it("keeps a single row however often htmx swaps", () => {
		const page = openPage({
			mainHtml: readerMain({ card: SERVER_CARD, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));
		page.document.body.dispatchEvent(new page.window.Event("htmx:afterSwap"));

		expect(rowKeys(page.document)).toEqual(["offline", ...SERVER_ROW_KEYS]);
		expect(page.announced).toHaveLength(1);
	});

	it.each([
		["the server's card", SERVER_CARD, ["offline", ...SERVER_ROW_KEYS]],
		["the card it added", NO_SERVER_CARD, ["offline"]],
	])("moves the row in %s to the saved time of the next stored copy the shell records", async (_name, card, keys) => {
		const page = openPage({
			mainHtml: readerMain({ card, template: COPY_TEMPLATE }),
			copy: { path: READER_PATH, savedAt: COPY_SAVED_AT },
		});

		page.recordCopy({ path: READER_PATH, savedAt: LATER_SAVED_AT });
		await observed();

		const row = pickOfflineRow(page.document);
		expect(rowKeys(page.document)).toEqual(keys);
		expect(row.getAttribute("data-offline-copy-row")).toBe(LATER_SAVED_AT);
		expect(stampOf(row, "date")).toEqual({ className: "article-history__date", datetime: LATER_SAVED_AT, label: "Oct 5, 2026" });
		expect(stampOf(row, "time")).toEqual({ className: "article-history__time", datetime: LATER_SAVED_AT, label: "08:30 AM" });
		expect(page.document.querySelectorAll("details[data-test-article-history]")).toHaveLength(1);
	});
});
