declare global {
	interface Window {
		__popupSaveMessages: { url: string; title: string }[];
		__popupSaveAllMessages: { type: string; runId?: string; windowId?: number }[];
		__popupAcknowledgements: number;
		__popupClosed: number;
		__popupEmitRecord?: (kind: EmittedRecord) => void;
		__popupReleaseFollow?: () => void;
		__popupReleaseStart?: () => void;
		__popupReleaseItems?: () => void;
		__popupReleaseSave?: () => void;
		__popupReleaseLoadPage?: () => void;
	}
}

/** The instant every captured popup is frozen at. Relative timestamps ("2h
 * ago") are the popup's only clock-derived copy, so the capture pins the clock
 * rather than choosing ages that merely round the same way for a while. */
export const FIXED_NOW = Date.parse("2026-03-10T12:00:00.000Z");

export const WIDE_TITLE = "How thoughtful software teams build tools that remain useful for decades";
export const OVERSIZED_TITLE = "A complete history of every decision behind the architecture of a reading list application and the surprising consequences for people who save hundreds of articles every day across multiple browsers and devices";

const ROWS = [
	{ title: WIDE_TITLE, host: "practicaltypography.com", agoMs: 45_000 },
	{ title: OVERSIZED_TITLE, host: "grugbrain.dev", agoMs: 2 * 60 * 60 * 1000 },
	{ title: "Reflections on Trusting Trust", host: "cs.cmu.edu", agoMs: 26 * 60 * 60 * 1000 },
	{ title: "A Plea for Lean Software", host: "cr.yp.to", agoMs: 5 * 24 * 60 * 60 * 1000 },
];

const DEFAULT_ROW_COUNT = ROWS.length;

const TOTAL_PAGES = 9;
const CURRENT_PAGE_INDEX = 4;

const MARK_AS_READ = { name: "update-status", title: "Mark as read" };

const TOTAL = { label: "86 Saved Articles" };

const SORT = [
	{ label: "Newest first", rel: "current", order: "desc" },
	{ label: "Oldest first", rel: "sort", order: "asc" },
];

function items(rowCount: number): unknown[] {
	return Array.from({ length: rowCount }, (_row, index) => {
		const row = ROWS[index % ROWS.length];
		return {
			id: `visual-item-${index}`,
			url: `https://${row.host}/article-${index}`,
			title: row.title,
			savedAt: new Date(FIXED_NOW - row.agoMs).toISOString(),
			actions: [MARK_AS_READ],
			links: [{ rel: "read", title: "Read", href: `https://${row.host}/article-${index}` }],
			needsBrowserCapture: false,
		};
	});
}

/** Deliberately holds a pinned tab and two pages the save filters out, because
 * the control counts every tab present and the summary reports an outcome for
 * each — including the ones skipped before the request. */
function openTabs(): unknown[] {
	const ordinary = Array.from({ length: 7 }, (_tab, index) => ({
		id: index + 2,
		url: `https://example.com/open-tab-${index}`,
		title: `Open tab ${index}`,
		windowId: 1,
	}));
	return [
		{ id: 1, url: "https://example.com/pinned", title: "Pinned reading", pinned: true, windowId: 1 },
		...ordinary,
		{ id: 9, url: "chrome://settings", title: "Settings", windowId: 1 },
		{ id: 10, url: "https://readplace.com/queue", title: "Readplace", windowId: 1 },
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

function messagesReply(): unknown {
	return {
		ok: false,
		messages: [
			{ type: "success", content: { type: "text/html", body: "Saved to your readlist." } },
			{ type: "warning", content: { type: "text/html", body: "This page was already in your readlist." } },
			{
				type: "error",
				content: {
					type: "text/html",
					body: 'Your account is locked. Email <a href="mailto:support@readplace.com">support@readplace.com</a> to restore access.',
				},
			},
		],
	};
}

function notSaveableReply(rowCount: number): unknown {
	return {
		ok: false,
		reason: "not-saveable",
		items: items(rowCount),
		pages: [],
		sort: [],
		warning: { code: "unsupported_scheme", message: "Only http and https pages can be saved." },
	};
}

export type SaveReply = "hold" | "error" | "saved" | "messages" | "not-saveable";

export type ListReply = "items" | "empty" | "error" | "logged-out";

export type SaveAllStart = "acknowledge" | "progress" | "covered" | "held" | "lost" | "rejected";

export type SaveAllFollow = "finished" | "held" | "null" | "lost";

type EmittedRecord = "capturing" | "progress" | "sent" | "finished" | "retried" | "other-window" | "empty";

export type SeededRun = { windowId: number; phase: "running" | "finished"; url: string };

function listReplyScript(listReply: ListReply, itemsReply: string): string {
	if (listReply === "empty") {
		return JSON.stringify({ ok: true, value: { items: [], pages: [], total: { label: "0 Saved Articles" }, sort: [] } });
	}
	if (listReply === "error") return JSON.stringify({ ok: false, reason: "error" });
	if (listReply === "logged-out") return JSON.stringify({ ok: false, reason: "not-logged-in" });
	return itemsReply;
}

/** Installs the extension runtime the popup expects, answering only what the
 * list state reads. Both globals are defined so `webextension-polyfill` takes
 * its passthrough branch — given only `chrome` it wraps every method in
 * callback-to-promise adapters that a stub would then have to imitate. */
export function popupRuntimeStub(options?: {
	holdItems?: boolean;
	holdLoadPage?: boolean;
	saveReplies?: SaveReply[];
	listReply?: ListReply;
	pendingBulkSave?: boolean;
	rowCount?: number;
	saveAllStart?: SaveAllStart;
	saveAllFollows?: SaveAllFollow[];
	seededRuns?: SeededRun[];
}): string {
	const holdItems = options?.holdItems === true;
	const holdLoadPage = options?.holdLoadPage === true;
	const saveReplies = JSON.stringify(options?.saveReplies ?? []);
	const rowCount = options?.rowCount ?? DEFAULT_ROW_COUNT;
	const itemsReply = listReplyScript(
		options?.listReply ?? "items",
		JSON.stringify({ ok: true, value: { items: items(rowCount), pages: pages(), total: TOTAL, sort: SORT } }),
	);
	const pendingBulkSave = options?.pendingBulkSave === true;
	const saveAllStart = JSON.stringify(options?.saveAllStart ?? "acknowledge");
	const saveAllFollows = JSON.stringify(options?.saveAllFollows ?? ["finished"]);
	const seededRuns = JSON.stringify(options?.seededRuns ?? []);
	return `
		globalThis.__popupSaveMessages = [];
		globalThis.__popupSaveAllMessages = [];
		globalThis.__popupAcknowledgements = 0;
		globalThis.__popupClosed = 0;
		globalThis.close = function () { globalThis.__popupClosed += 1; };
		const __saveAllStart = ${saveAllStart};
		const __saveAllFollows = ${saveAllFollows};
		let __followCall = 0;
		let __lastStart = null;
		let __revision = 1;
		const __changeListeners = [];
		function __linkOf(url, state) {
			const base = { url: url, jobId: null, tooBigMb: null };
			if (state === "failed") return Object.assign(base, { state: state, unauthorized: false });
			return Object.assign(base, { state: state });
		}
		const __statesByKind = {
			capturing: function () { return "capturing"; },
			progress: function (index) { return index < 3 ? "saved" : "sending"; },
			sent: function () { return "saved"; },
			finished: function (index, count) { return index === 0 ? "already-saved" : index === count - 1 ? "failed" : "saved"; },
			retried: function (index) { return index === 0 ? "already-saved" : "saved"; },
		};
		function __runOf(input) {
			__revision += 1;
			const message = __lastStart;
			const finished = input.kind === "finished" || input.kind === "retried";
			return {
				id: input.runId || message.runId,
				windowId: input.windowId || 1,
				joinedIds: [],
				epoch: 0,
				revision: __revision,
				phase: finished ? "finished" : "running",
				links: message.tabs.map(function (tab, index) {
					return __linkOf(tab.url, __statesByKind[input.kind](index, message.tabs.length));
				}),
				clientSkips: message.skipped,
				notified: finished,
				outcomeSeen: false,
			};
		}
		const __seededRuns = ${seededRuns}.map(function (seed, index) {
			return {
				id: "00000000-0000-4000-8000-00000000000" + (index + 1),
				windowId: seed.windowId,
				joinedIds: [],
				epoch: 0,
				revision: 1,
				phase: seed.phase,
				links: [__linkOf(seed.url, seed.phase === "finished" ? "saved" : "sending")],
				clientSkips: [],
				notified: seed.phase === "finished",
				outcomeSeen: false,
			};
		});
		if (__seededRuns.length > 0) {
			__lastStart = { runId: __seededRuns[0].id, tabs: [{ url: __seededRuns[0].links[0].url }], skipped: [] };
		}
		globalThis.__popupEmitRecord = function (kind) {
			let runs;
			if (kind === "empty") runs = [];
			else if (kind === "other-window") runs = [__runOf({ kind: "progress", runId: "33333333-3333-4333-8333-333333333333", windowId: 2 })];
			else runs = [__runOf({ kind: kind })];
			for (const listener of __changeListeners) listener({ hutch_bulk_save_runs: { newValue: runs } }, "session");
		};
		function __answerStart(message) {
			__lastStart = message;
			if (__saveAllStart === "lost") return Promise.resolve(undefined);
			if (__saveAllStart === "rejected") return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
			if (__saveAllStart === "held") {
				return new Promise(function (resolve) {
					globalThis.__popupReleaseStart = function () { resolve({ ok: true, run: __runOf({ kind: "capturing" }) }); };
				});
			}
			const kind = __saveAllStart === "progress" ? "progress" : __saveAllStart === "covered" ? "finished" : "capturing";
			return Promise.resolve({ ok: true, run: __runOf({ kind: kind }) });
		}
		function __answerFollow() {
			const mode = __saveAllFollows[Math.min(__followCall, __saveAllFollows.length - 1)];
			__followCall += 1;
			if (mode === "lost") return Promise.resolve(undefined);
			if (mode === "null") return Promise.resolve({ ok: true, run: null });
			if (mode === "held") {
				return new Promise(function (resolve) {
					globalThis.__popupReleaseFollow = function () { resolve({ ok: true, run: __runOf({ kind: "finished" }) }); };
				});
			}
			return Promise.resolve({ ok: true, run: __runOf({ kind: "finished" }) });
		}
		const __saveReplies = ${saveReplies};
		const __savedReply = { ok: true, value: ${JSON.stringify(savedReply())} };
		const __messagesReply = { ok: true, value: ${JSON.stringify(messagesReply())} };
		const __notSaveableReply = { ok: true, value: ${JSON.stringify(notSaveableReply(rowCount))} };
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
						if (reply === "messages") { return Promise.resolve(__messagesReply); }
						if (reply === "not-saveable") { return Promise.resolve(__notSaveableReply); }
					}
					if (message && message.type === "save-all-tabs") {
						globalThis.__popupSaveAllMessages.push(message);
						return __answerStart(message);
					}
					if (message && message.type === "follow-save-all") {
						globalThis.__popupSaveAllMessages.push(message);
						return __answerFollow();
					}
					if (message && message.type === "acknowledge-save-all") {
						globalThis.__popupAcknowledgements += 1;
						return Promise.resolve({ ok: true });
					}
					if (message && message.type === "logout") { return Promise.resolve({ ok: true }); }
					return Promise.resolve({ ok: true, value: null });
				},
			},
			storage: {
				session: {
					get: function (key) {
						const keys = Array.isArray(key) ? key : [key];
						const stored = {};
						if (${pendingBulkSave} && keys.includes("pendingBulkSave")) stored.pendingBulkSave = true;
						if (keys.includes("hutch_bulk_save_runs") && __seededRuns.length > 0) stored.hutch_bulk_save_runs = __seededRuns;
						return Promise.resolve(stored);
					},
					remove: function () { return Promise.resolve(); },
				},
				onChanged: { addListener: function (listener) { __changeListeners.push(listener); } },
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

export function popupToolbarUrl(packagedPopupPath: string): string {
	return `file://${packagedPopupPath}`;
}

export function popupSaveUrl(packagedPopupPath: string): string {
	return `file://${packagedPopupPath}?url=${encodeURIComponent(SAVED_URL)}&title=${encodeURIComponent("Example Article")}`;
}
