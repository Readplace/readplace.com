declare global {
	interface Window {
		__popupSaveMessages: { url: string; title: string }[];
		__popupReleaseItems?: () => void;
		__popupReleaseSave?: () => void;
		__popupReleaseLoadPage?: () => void;
	}
}

/** The instant every captured popup is frozen at. Relative timestamps ("2h
 * ago") are the popup's only clock-derived copy, so the capture pins the clock
 * rather than choosing ages that merely round the same way for a while. */
export const FIXED_NOW = Date.parse("2026-03-10T12:00:00.000Z");

/** Six rows fill the list without reaching the 360px scroll cap, so no
 * platform-drawn scrollbar enters the frame. */
const ROWS = [
	{ title: "How the Web Became Unreadable", host: "practicaltypography.com", agoMs: 45_000 },
	{ title: "The Grug Brained Developer", host: "grugbrain.dev", agoMs: 2 * 60 * 60 * 1000 },
	{ title: "Reflections on Trusting Trust", host: "cs.cmu.edu", agoMs: 26 * 60 * 60 * 1000 },
	{ title: "A Plea for Lean Software", host: "cr.yp.to", agoMs: 5 * 24 * 60 * 60 * 1000 },
	{ title: "Out of the Tar Pit", host: "curtclifton.net", agoMs: 40 * 24 * 60 * 60 * 1000 },
	{ title: "The Rise of Worse Is Better", host: "dreamsongs.com", agoMs: 400 * 24 * 60 * 60 * 1000 },
];

/** The only shape that renders both gaps, so the pager reaches its widest
 * form — first, gap, a five-page window, gap, last — plus the two step
 * controls. */
const TOTAL_PAGES = 9;
const CURRENT_PAGE_INDEX = 4;

function items(): unknown[] {
	return ROWS.map((row, index) => ({
		id: `visual-item-${index}`,
		url: `https://${row.host}/article`,
		title: row.title,
		savedAt: new Date(FIXED_NOW - row.agoMs).toISOString(),
		actions: [{ name: "delete", title: "Delete" }],
		links: [{ rel: "read", title: "Read", href: `https://${row.host}/article` }],
		needsBrowserCapture: false,
	}));
}

/** Deliberately holds a pinned tab and two pages the save filters out, because
 * the control counts every tab present and the summary reports an outcome for
 * each — including the ones skipped before the request. */
function openTabs(): unknown[] {
	const ordinary = Array.from({ length: 7 }, (_tab, index) => ({
		id: index + 2,
		url: `https://example.com/open-tab-${index}`,
		title: `Open tab ${index}`,
	}));
	return [
		{ id: 1, url: "https://example.com/pinned", title: "Pinned reading", pinned: true },
		...ordinary,
		{ id: 9, url: "chrome://settings", title: "Settings" },
		{ id: 10, url: "https://readplace.com/queue", title: "Readplace" },
	];
}

function pages(): unknown[] {
	return Array.from({ length: TOTAL_PAGES }, (_page, index) => ({
		label: String(index + 1),
		rel: index < CURRENT_PAGE_INDEX ? "prev" : index === CURRENT_PAGE_INDEX ? "current" : "next",
	}));
}

const SAVED_URL = "https://example.com/article";

function savedReply(): unknown {
	return {
		ok: true,
		item: {
			id: "visual-saved",
			url: SAVED_URL,
			title: "Example Article",
			savedAt: new Date(FIXED_NOW - 45_000).toISOString(),
			actions: [],
			links: [
				{ rel: "read", title: "Read", href: SAVED_URL },
				{ rel: "collection", title: "View Readlist", href: "https://readplace.com/queue" },
			],
			needsBrowserCapture: false,
		},
		messages: [
			{ type: "success", content: { type: "text/html", body: "Article saved" } },
			{ type: "success", content: { type: "text/html", body: "Saved to your reading list" } },
		],
	};
}

export type SaveReply = "hold" | "error" | "saved";

/** Installs the extension runtime the popup expects, answering only what the
 * list state reads. Both globals are defined so `webextension-polyfill` takes
 * its passthrough branch — given only `chrome` it wraps every method in
 * callback-to-promise adapters that a stub would then have to imitate. */
export function popupRuntimeStub(options?: {
	holdItems?: boolean;
	holdLoadPage?: boolean;
	saveReplies?: SaveReply[];
}): string {
	const holdItems = options?.holdItems === true;
	const holdLoadPage = options?.holdLoadPage === true;
	const saveReplies = JSON.stringify(options?.saveReplies ?? []);
	const itemsReply = `{ ok: true, value: { items: ${JSON.stringify(items())}, pages: ${JSON.stringify(pages())} } }`;
	return `
		globalThis.__popupSaveMessages = [];
		const __saveReplies = ${saveReplies};
		const __savedReply = { ok: true, value: ${JSON.stringify(savedReply())} };
		let __saveCall = 0;
		globalThis.chrome = { runtime: { id: "visual-fixture" } };
		globalThis.browser = {
			runtime: {
				id: "visual-fixture",
				getURL: function (resource) { return resource; },
				sendMessage: function (message) {
					if (message && message.type === "get-all-items") {
						${
							holdItems
								? `return new Promise(function (resolve) {
										globalThis.__popupReleaseItems = function () { resolve(${itemsReply}); };
									});`
								: `return Promise.resolve(${itemsReply});`
						}
					}
					if (message && message.type === "load-page") {
						${
							holdLoadPage
								? `return new Promise(function (resolve) {
										globalThis.__popupReleaseLoadPage = function () { resolve(${itemsReply}); };
									});`
								: `return Promise.resolve(${itemsReply});`
						}
					}
					if (message && message.type === "save-current-tab") {
						globalThis.__popupSaveMessages.push({ url: message.url, title: message.title });
						const reply = __saveReplies.length === 0
							? null
							: __saveReplies[Math.min(__saveCall, __saveReplies.length - 1)];
						__saveCall += 1;
						if (reply === "hold") {
							return new Promise(function (resolve) {
								globalThis.__popupReleaseSave = function () { resolve(__savedReply); };
							});
						}
						if (reply === "error") { return Promise.resolve({ ok: false, reason: "error" }); }
						if (reply === "saved") { return Promise.resolve(__savedReply); }
					}
					if (message && message.type === "logout") { return Promise.resolve({ ok: true }); }
					return Promise.resolve({ ok: true, value: null });
				},
			},
			storage: {
				session: {
					get: function () { return Promise.resolve({}); },
					remove: function () { return Promise.resolve(); },
				},
				local: {
					get: function () { return Promise.resolve({ hutch_advertised_capabilities: ["save-article", "save-articles"] }); },
				},
			},
			tabs: {
				query: function () {
					return Promise.resolve(${JSON.stringify(openTabs())});
				},
			},
			commands: { getAll: function () { return Promise.resolve([]); } },
		};
	`;
}

/** The popup reads its target from the query string before it reaches for the
 * active tab, and treats a loopback URL as one of the app's own pages — which
 * is what sends it straight to the list instead of saving anything. */
export function popupListUrl(packagedPopupPath: string): string {
	return `file://${packagedPopupPath}?url=${encodeURIComponent("http://localhost/")}`;
}

export function popupSaveUrl(packagedPopupPath: string): string {
	return `file://${packagedPopupPath}?url=${encodeURIComponent(SAVED_URL)}&title=${encodeURIComponent("Example Article")}`;
}
