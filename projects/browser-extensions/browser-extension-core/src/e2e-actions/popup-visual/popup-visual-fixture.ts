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

/** Installs the extension runtime the popup expects, answering only what the
 * list state reads. Both globals are defined so `webextension-polyfill` takes
 * its passthrough branch — given only `chrome` it wraps every method in
 * callback-to-promise adapters that a stub would then have to imitate. */
export function popupRuntimeStub(): string {
	return `
		globalThis.chrome = { runtime: { id: "visual-fixture" } };
		globalThis.browser = {
			runtime: {
				id: "visual-fixture",
				getURL: function (resource) { return resource; },
				sendMessage: function (message) {
					if (message && message.type === "get-all-items") {
						return Promise.resolve({
							ok: true,
							value: { items: ${JSON.stringify(items())}, pages: ${JSON.stringify(pages())} },
						});
					}
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
