import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryAuth } from "./auth/in-memory-auth";
import { UnauthorizedError } from "./auth/unauthorized-error";
import { BrowserExtensionCore } from "./core";
import type { CoreError, ReadingList } from "./core";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
import type { BulkSaveResult, BulkSavePage, ItemsPage, MoreItemsPage, SaveUrl, SavePages, SaveUrlResult } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";
import type { Auth, GuardedResult, WhenLoggedIn } from "./auth/auth.types";
import type { ReadingListItem, ReadingListItemId } from "./domain/reading-list-item.types";
import { MENU_ITEM_SAVE_ALL_TABS } from "./get-context-menu-target";

interface FakeShell {
	shell: BrowserShell;
	showSavedCalls: number[];
	showDefaultCalls: number[];
	iconUpdated: Promise<void>;
	getOpenSaveAllTabsPopupCount: () => number;
	triggerContextMenu: (
		info: { menuItemId: string; linkUrl?: string; pageUrl?: string },
		tab?: { id?: number; url?: string; title?: string },
	) => void;
	triggerSaveAllTabsShortcut: () => void;
}

function createFakeShell(
	activeTab: { id?: number; url: string; title: string } | null = null,
): FakeShell {
	const showSavedCalls: number[] = [];
	const showDefaultCalls: number[] = [];
	let openSaveAllTabsPopupCount = 0;
	let contextMenuHandler: Parameters<BrowserShell["onContextMenuClicked"]>[0] = () => {};
	let saveAllTabsShortcutHandler: () => void = () => {};
	let resolveIconUpdated!: () => void;
	const iconUpdated = new Promise<void>((resolve) => {
		resolveIconUpdated = resolve;
	});
	const shell: BrowserShell = {
		onShortcutPressed: () => {},
		openPopup: () => {},
		openSaveAllTabsPopup: () => {
			openSaveAllTabsPopupCount += 1;
		},
		onSaveAllTabsShortcut: (handler) => {
			saveAllTabsShortcutHandler = handler;
		},
		getActiveTab: async () => activeTab,
		queryActiveTabs: async () => [],
		setIcon: {
			showSaved: async (tabId) => {
				showSavedCalls.push(tabId);
				resolveIconUpdated();
			},
			showDefault: async (tabId) => {
				showDefaultCalls.push(tabId);
				resolveIconUpdated();
			},
		},
		createContextMenus: () => {},
		onContextMenuClicked: (handler) => {
			contextMenuHandler = handler;
		},
		onTabActivated: () => {},
		onTabUpdated: () => {},
	};
	return {
		shell,
		showSavedCalls,
		showDefaultCalls,
		iconUpdated,
		getOpenSaveAllTabsPopupCount: () => openSaveAllTabsPopupCount,
		triggerContextMenu: (info, tab) => contextMenuHandler(info, tab),
		triggerSaveAllTabsShortcut: () => saveAllTabsShortcutHandler(),
	};
}

type SaveArgs = { url: string; title: string; content?: { bytes: ArrayBuffer; mediaType: string } };

function createRecordingReadingList(
	options: {
		saveResult?: SaveUrlResult;
		savePagesResult?: BulkSaveResult;
		failSavePagesOnCall?: { call: number; error: Error };
	} = {},
): ReadingList & {
	saveCalls: SaveArgs[];
	savePagesCalls: { pages: BulkSavePage[] }[];
	findByUrlCalls: string[];
} {
	const inner = initInMemoryReadingList();
	const saveCalls: SaveArgs[] = [];
	const savePagesCalls: { pages: BulkSavePage[] }[] = [];
	/** findByUrl is the only reading-list call that asks the server to describe
	 * the collection, so recording it is how a test pins that a flow issued no
	 * list request the reader did not trigger. */
	const findByUrlCalls: string[] = [];
	const saveUrl: SaveUrl = async (params) => {
		saveCalls.push(params);
		if (options.saveResult) return options.saveResult;
		return inner.saveUrl(params);
	};
	const savePages: SavePages = async (params) => {
		savePagesCalls.push(params);
		if (
			options.failSavePagesOnCall &&
			savePagesCalls.length === options.failSavePagesOnCall.call
		) {
			throw options.failSavePagesOnCall.error;
		}
		if (options.savePagesResult) return options.savePagesResult;
		return inner.savePages(params);
	};
	return {
		saveCalls,
		savePagesCalls,
		findByUrlCalls,
		saveUrl,
		savePages,
		invokeAction: inner.invokeAction,
		findByUrl: async (url) => {
			findByUrlCalls.push(url);
			return inner.findByUrl(url);
		},
		getItems: inner.getItems,
		getMoreItems: inner.getMoreItems,
	};
}

describe("BrowserExtensionCore save", () => {
	it("marks the exact invoking tab as saved, ignoring which tab is active now", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, showSavedCalls, showDefaultCalls, iconUpdated } =
			createFakeShell({ id: 7, url: "https://other.example", title: "Other" });
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
			tabId: 42,
		});

		await iconUpdated;
		expect(showSavedCalls).toEqual([42]);
		expect(showDefaultCalls).toEqual([]);
	});

	it("asks the server nothing to derive the icon when the save carries no tab", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, showSavedCalls, showDefaultCalls } = createFakeShell({
			id: 7,
			url: "https://active.example",
			title: "Active",
		});
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
		});
		await flush();

		expect(showSavedCalls).toEqual([]);
		expect(showDefaultCalls).toEqual([]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("asks the server for no list when a save succeeds", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, showSavedCalls } = createFakeShell({
			id: 7,
			url: "https://example.com/article",
			title: "Article",
		});
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
			tabId: 42,
		});
		await flush();

		expect(showSavedCalls).toEqual([42]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("does not mark the invoking tab as saved when the result is not saveable", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList({
			saveResult: { ok: false, reason: "not-saveable", items: [] },
		});
		const { shell, showSavedCalls, showDefaultCalls } = createFakeShell({
			id: 7,
			url: "https://active.example",
			title: "Active",
		});
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
			tabId: 42,
		});
		await flush();

		expect(showSavedCalls).toEqual([]);
		expect(showDefaultCalls).toEqual([]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("mints a web session when a save is not saveable and drops into the reader list", async () => {
		const auth = loggedInAuth();
		let mintCalls = 0;
		auth.ensureWebSession = async () => {
			mintCalls += 1;
		};
		const readingList = createRecordingReadingList({
			saveResult: { ok: false, reason: "not-saveable", items: [] },
		});
		const { shell } = createFakeShell({
			id: 7,
			url: "https://active.example",
			title: "Active",
		});
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
			tabId: 42,
		});
		await flush();

		expect(mintCalls).toBe(1);
	});
});

type ShortcutHandler = () => void;
type ContextMenuHandler = (
	info: { menuItemId: string; linkUrl?: string; pageUrl?: string },
	tab?: { id?: number; url?: string; title?: string },
) => void;
type TabHandler = (tabId: number, url: string) => void;

interface Captured {
	shell: BrowserShell;
	openPopupCalls: Array<{ url: string; title: string; tabId?: number }>;
	showSavedCalls: number[];
	showDefaultCalls: number[];
	fireShortcut: () => void;
	fireContextMenu: ContextMenuHandler;
	fireTabActivated: TabHandler;
	fireTabUpdated: TabHandler;
}

function createCapturingShell(
	options: {
		activeTab?: { id?: number; url: string; title: string } | null;
		activeTabs?: Array<{ id?: number; url?: string; title?: string }>;
	} = {},
): Captured {
	const openPopupCalls: Array<{ url: string; title: string; tabId?: number }> = [];
	const showSavedCalls: number[] = [];
	const showDefaultCalls: number[] = [];
	let shortcutHandler: ShortcutHandler = () => {};
	let contextMenuHandler: ContextMenuHandler = () => {};
	let tabActivatedHandler: TabHandler = () => {};
	let tabUpdatedHandler: TabHandler = () => {};

	const shell: BrowserShell = {
		onShortcutPressed: (handler) => {
			shortcutHandler = handler;
		},
		openPopup: (params) => {
			openPopupCalls.push(params);
		},
		openSaveAllTabsPopup: () => {},
		onSaveAllTabsShortcut: () => {},
		getActiveTab: async () => options.activeTab ?? null,
		queryActiveTabs: async () => options.activeTabs ?? [],
		setIcon: {
			showSaved: async (tabId) => {
				showSavedCalls.push(tabId);
			},
			showDefault: async (tabId) => {
				showDefaultCalls.push(tabId);
			},
		},
		createContextMenus: () => {},
		onContextMenuClicked: (handler) => {
			contextMenuHandler = handler;
		},
		onTabActivated: (handler) => {
			tabActivatedHandler = handler;
		},
		onTabUpdated: (handler) => {
			tabUpdatedHandler = handler;
		},
	};

	return {
		shell,
		openPopupCalls,
		showSavedCalls,
		showDefaultCalls,
		fireShortcut: () => shortcutHandler(),
		fireContextMenu: (info, tab) => contextMenuHandler(info, tab),
		fireTabActivated: (tabId, url) => tabActivatedHandler(tabId, url),
		fireTabUpdated: (tabId, url) => tabUpdatedHandler(tabId, url),
	};
}

function loggedInAuth(): Auth {
	const whenLoggedIn: WhenLoggedIn = (fn) => ({ ok: true, value: fn() });
	return {
		login: async () => ({ ok: true }),
		logout: async () => {},
		refreshTokens: async () => ({ ok: true }),
		getAccessToken: async () => "token",
		ensureWebSession: async () => {},
		whenLoggedIn,
	};
}

function makeItem(url: string): ReadingListItem {
	return {
		id: "id-1" as ReadingListItemId,
		url,
		title: "Title",
		savedAt: new Date(0),
		actions: [],
		links: [],
	};
}

const logger = HutchLogger.from(noopLogger);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadedPage(page: MoreItemsPage | undefined): ItemsPage {
	if (page === undefined || !("items" in page)) {
		throw new Error("expected a loaded page, not a lost continuation");
	}
	return page;
}

describe("BrowserExtensionCore init", () => {
	it("opens the popup for the context-menu target", () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireContextMenu(
			{ menuItemId: "save-page-to-hutch", pageUrl: "https://page.example" },
			{ url: "https://page.example", title: "Page" },
		);

		expect(cap.openPopupCalls).toEqual([
			{ url: "https://page.example", title: "Page" },
		]);
	});

	it("hands the popup the tab a context-menu page save is for", () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireContextMenu(
			{ menuItemId: "save-page-to-hutch", pageUrl: "https://page.example" },
			{ id: 21, url: "https://page.example", title: "Page" },
		);

		expect(cap.openPopupCalls[0]?.tabId).toBe(21);
	});

	it("ignores a context-menu click with no resolvable target", () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireContextMenu({ menuItemId: "unknown" });

		expect(cap.openPopupCalls).toEqual([]);
	});

	it("opens the popup for the shortcut target", async () => {
		const cap = createCapturingShell({
			activeTabs: [{ id: 1, url: "https://shortcut.example", title: "Sc" }],
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireShortcut();
		await flush();

		expect(cap.openPopupCalls).toEqual([
			{ url: "https://shortcut.example", title: "Sc", tabId: 1 },
		]);
	});

	it("ignores a shortcut press with no active tab target", async () => {
		const cap = createCapturingShell({ activeTabs: [] });
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireShortcut();
		await flush();

		expect(cap.openPopupCalls).toEqual([]);
	});

	it("logs when resolving the shortcut target rejects", async () => {
		const errors: unknown[] = [];
		const recordingLogger = HutchLogger.from({
			...noopLogger,
			error: (...args: unknown[]) => {
				errors.push(args);
			},
		});
		const cap = createCapturingShell();
		cap.shell.queryActiveTabs = async () => {
			throw new Error("boom");
		};
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger: recordingLogger,
			readingList: initInMemoryReadingList(),
		});
		core.init();

		cap.fireShortcut();
		await flush();

		expect(errors).toHaveLength(1);
	});

	it("refreshes the icon on tab activation and update", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://saved.example", title: "Saved" });
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		core.init();

		cap.fireTabActivated(3, "https://saved.example");
		cap.fireTabUpdated(4, "https://unsaved.example");
		await flush();

		expect(cap.showSavedCalls).toEqual([3]);
		expect(cap.showDefaultCalls).toEqual([4]);
	});
});

describe("BrowserExtensionCore login/logout", () => {
	it("emits logged-in and refreshes the active tab icon", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://active.example", title: "A" });
		const cap = createCapturingShell({
			activeTab: { id: 9, url: "https://active.example", title: "A" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const events: string[] = [];
		core.on("logged-in", { success: () => events.push("ok"), failure: () => {} });

		core.login();
		await flush();

		expect(events).toEqual(["ok"]);
		expect(cap.showSavedCalls).toEqual([9]);
	});

	it("emits a failure when login rejects", async () => {
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.login = async () => {
			throw new Error("nope");
		};
		const core = BrowserExtensionCore(cap.shell, { auth, logger, readingList: initInMemoryReadingList() });
		const failures: unknown[] = [];
		core.on("logged-in", { success: () => {}, failure: (e) => failures.push(e) });

		core.login();
		await flush();

		expect(failures).toEqual([{ reason: "error", error: new Error("nope") }]);
	});

	it("wraps a non-Error login rejection in an Error result", async () => {
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.login = async () => {
			throw "string rejection";
		};
		const core = BrowserExtensionCore(cap.shell, { auth, logger, readingList: initInMemoryReadingList() });
		const failures: Array<{ reason: string; error?: Error }> = [];
		core.on("logged-in", { success: () => {}, failure: (e) => failures.push(e) });

		core.login();
		await flush();

		expect(failures).toHaveLength(1);
		expect(failures[0].error?.message).toBe("string rejection");
	});

	it("emits logged-out and refreshes the active tab icon", async () => {
		const cap = createCapturingShell({
			activeTab: { id: 5, url: "https://x.example", title: "X" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const events: string[] = [];
		core.on("logged-out", () => events.push("out"));

		core.logout();
		await flush();

		expect(events).toEqual(["out"]);
		expect(cap.showDefaultCalls).toEqual([5]);
	});

	it("swallows a logout rejection", async () => {
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.logout = async () => {
			throw new Error("logout failed");
		};
		const core = BrowserExtensionCore(cap.shell, { auth, logger, readingList: initInMemoryReadingList() });

		core.logout();
		await flush();

		expect(cap.showDefaultCalls).toEqual([]);
	});
});

describe("BrowserExtensionCore invoke/fetch", () => {
	it("invokes a per-item action and refreshes the icon", async () => {
		const readingList = initInMemoryReadingList();
		const saved = await readingList.saveUrl({ url: "https://i.example", title: "I" });
		assert(saved.ok, "save should succeed for a fresh url");
		const id = saved.item.id;
		const cap = createCapturingShell({
			activeTab: { id: 3, url: "https://i.example", title: "I" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const results: unknown[] = [];
		core.on("invoked-item-action", { success: (v) => results.push(v), failure: () => {} });

		core.invoke("item-action", { id, name: "update-status" });
		await flush();

		expect(results).toHaveLength(1);
		expect(cap.showSavedCalls).toEqual([3]);
	});

	it("asks the server nothing when the mutated article is not the tab's page", async () => {
		const readingList = createRecordingReadingList();
		const saved = await readingList.saveUrl({ url: "https://i.example", title: "I" });
		assert(saved.ok, "save should succeed for a fresh url");
		const cap = createCapturingShell({
			activeTab: { id: 3, url: "https://elsewhere.example", title: "E" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});

		core.invoke("item-action", { id: saved.item.id, name: "update-status" });
		await flush();

		expect(cap.showSavedCalls).toEqual([]);
		expect(cap.showDefaultCalls).toEqual([]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("asks the server nothing when no tab is active to mark", async () => {
		const readingList = createRecordingReadingList();
		const saved = await readingList.saveUrl({ url: "https://i.example", title: "I" });
		assert(saved.ok, "save should succeed for a fresh url");
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});

		core.invoke("item-action", { id: saved.item.id, name: "update-status" });
		await flush();

		expect(cap.showSavedCalls).toEqual([]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("skips the icon entirely when the server no longer advertises the action", async () => {
		const readingList = createRecordingReadingList();
		const cap = createCapturingShell({
			activeTab: { id: 3, url: "https://i.example", title: "I" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});

		core.invoke("item-action", {
			id: "ghost" as ReadingListItemId,
			name: "update-status",
		});
		await flush();

		expect(cap.showSavedCalls).toEqual([]);
		expect(cap.showDefaultCalls).toEqual([]);
		expect(readingList.findByUrlCalls).toEqual([]);
	});

	it("emits a failure and skips the icon refresh when invoking while logged out", async () => {
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.whenLoggedIn = (() => ({ ok: false, reason: "not-logged-in" })) as WhenLoggedIn;
		const core = BrowserExtensionCore(cap.shell, {
			auth,
			logger,
			readingList: initInMemoryReadingList(),
		});
		const failures: unknown[] = [];
		core.on("invoked-item-action", { success: () => {}, failure: (e) => failures.push(e) });

		core.invoke("item-action", {
			id: "any-id" as ReadingListItemId,
			name: "update-status",
		});
		await flush();

		expect(failures).toEqual([{ reason: "not-logged-in" }]);
		expect(cap.showDefaultCalls).toEqual([]);
	});

	it("fetches the reading list", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://f.example", title: "F" });
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const results: MoreItemsPage[] = [];
		core.on("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list");
		await flush();

		expect(results).toHaveLength(1);
		expect(loadedPage(results[0]).items).toHaveLength(1);
		expect(loadedPage(results[0]).hasMore).toBe(false);
	});

	it("fetches more of the reading list when asked for the next page", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		await readingList.saveUrl({ url: "https://g.example", title: "G" });
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth,
			logger,
			readingList,
		});
		const results: MoreItemsPage[] = [];
		core.once("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list", { more: true });
		await flush();

		expect(results).toHaveLength(1);
		expect(loadedPage(results[0]).items.map((item) => item.url)).toEqual([
			"https://g.example",
		]);
		expect(loadedPage(results[0]).hasMore).toBe(false);
	});

	it("forwards a lost continuation rather than dressing it up as an empty page", async () => {
		const readingList = createRecordingReadingList();
		readingList.getMoreItems = async () => ({ continuation: "lost" });
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const results: MoreItemsPage[] = [];
		core.once("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list", { more: true });
		await flush();

		expect(results).toEqual([{ continuation: "lost" }]);
	});

	it("mints a web session when fetching the reading list while logged in", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://w.example", title: "W" });
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		let mintCalls = 0;
		auth.ensureWebSession = async () => {
			mintCalls += 1;
		};
		const core = BrowserExtensionCore(cap.shell, { auth, logger, readingList });

		core.fetch("reading-list");
		await flush();

		expect(mintCalls).toBe(1);
	});

	it("does not mint a web session when fetching the reading list while logged out", async () => {
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.whenLoggedIn = (() => ({ ok: false, reason: "not-logged-in" })) as WhenLoggedIn;
		let mintCalls = 0;
		auth.ensureWebSession = async () => {
			mintCalls += 1;
		};
		const core = BrowserExtensionCore(cap.shell, {
			auth,
			logger,
			readingList: initInMemoryReadingList(),
		});

		core.fetch("reading-list");
		await flush();

		expect(mintCalls).toBe(0);
	});

	it("serves the list and logs when minting the web session fails", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://e.example", title: "E" });
		const cap = createCapturingShell();
		const auth = loggedInAuth();
		auth.ensureWebSession = async () => {
			throw new Error("mint failed");
		};
		const warns: unknown[][] = [];
		const capturingLogger = HutchLogger.from({
			...noopLogger,
			warn: (...args) => warns.push(args),
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth,
			logger: capturingLogger,
			readingList,
		});
		const results: MoreItemsPage[] = [];
		core.on("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list");
		await flush();

		expect(results).toHaveLength(1);
		expect(warns).toHaveLength(1);
	});

});

describe("BrowserExtensionCore result emission", () => {
	function authReturning<T>(result: GuardedResult<T>): Auth {
		const auth = loggedInAuth();
		auth.whenLoggedIn = (() => result) as WhenLoggedIn;
		return auth;
	}

	it("emits a failure for a guard rejection", async () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: authReturning({ ok: false, reason: "not-logged-in" }),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const failures: unknown[] = [];
		core.once("fetched-reading-list", { success: () => {}, failure: (e) => failures.push(e) });

		core.fetch("reading-list");
		await flush();

		expect(failures).toEqual([{ reason: "not-logged-in" }]);
	});

	it("maps an UnauthorizedError rejection to not-logged-in", async () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: authReturning({
				ok: true,
				value: Promise.reject(new UnauthorizedError()),
			}),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const failures: unknown[] = [];
		core.once("fetched-reading-list", { success: () => {}, failure: (e) => failures.push(e) });

		core.fetch("reading-list");
		await flush();

		expect(failures).toEqual([{ reason: "not-logged-in" }]);
	});

	it("preserves an Error rejection as the error result", async () => {
		const cap = createCapturingShell();
		const failure = new Error("kaboom");
		const core = BrowserExtensionCore(cap.shell, {
			auth: authReturning({ ok: true, value: Promise.reject(failure) }),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const failures: Array<{ reason: string; error?: Error }> = [];
		core.once("fetched-reading-list", { success: () => {}, failure: (e) => failures.push(e) });

		core.fetch("reading-list");
		await flush();

		expect(failures).toHaveLength(1);
		expect(failures[0].error).toBe(failure);
	});

	it("maps a non-Error rejection to an error result", async () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: authReturning({ ok: true, value: Promise.reject("string failure") }),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const failures: Array<{ reason: string; error?: Error }> = [];
		core.once("fetched-reading-list", { success: () => {}, failure: (e) => failures.push(e) });

		core.fetch("reading-list");
		await flush();

		expect(failures).toHaveLength(1);
		expect(failures[0].reason).toBe("error");
		expect(failures[0].error?.message).toBe("string failure");
	});

	it("emits a success synchronously for a non-promise value", async () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: authReturning({ ok: true, value: { items: [makeItem("https://sync.example")], hasMore: false } }),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const results: MoreItemsPage[] = [];
		core.once("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list");
		await flush();

		expect(results).toHaveLength(1);
		expect(loadedPage(results[0]).items[0]?.url).toBe("https://sync.example");
	});

});

describe("BrowserExtensionCore saveAll", () => {
	it("emits saved-all-tabs with the bulk summary the reading list returns", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const result = await new Promise<BulkSaveResult>((resolve, reject) => {
			core.once("saved-all-tabs", { success: resolve, failure: reject });
			core.saveAll("tabs", {
				pages: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
			});
		});

		expect(result).toEqual({ saved: 2, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] });
	});

	it("hands the whole window to the reading list, which splits it against what the server advertised", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const pages = Array.from({ length: 45 }, (_v, i) => ({ url: `https://example.com/${i}` }));

		await new Promise<BulkSaveResult>((resolve, reject) => {
			core.once("saved-all-tabs", { success: resolve, failure: reject });
			core.saveAll("tabs", { pages });
		});

		expect(readingList.savePagesCalls).toEqual([{ pages }]);
	});

	it("surfaces the tooBig pages the reading list reports", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList({
			savePagesResult: { saved: 1, skipped: 0, failed: 0, tooBig: [{ url: "https://big.example", mb: 25 }], skippedUrls: [] },
		});
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const result = await new Promise<BulkSaveResult>((resolve, reject) => {
			core.once("saved-all-tabs", { success: resolve, failure: reject });
			core.saveAll("tabs", {
				pages: [{ url: "https://big.example", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } }],
			});
		});

		expect(result.tooBig).toEqual([{ url: "https://big.example", mb: 25 }]);
	});

	it("logs the user out when the bulk save fails with a 401", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList({
			failSavePagesOnCall: { call: 1, error: new UnauthorizedError() },
		});
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const error = await new Promise<CoreError>((resolve) => {
			core.once("saved-all-tabs", {
				success: () => resolve({ reason: "error", error: new Error("unexpected success") }),
				failure: resolve,
			});
			core.saveAll("tabs", { pages: [{ url: "https://example.com/a" }] });
		});

		expect(error).toEqual({ reason: "not-logged-in" });
	});

	it("aggregates skipped urls reported by the reading list", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		/** The in-memory list reports a re-save of the same url as skipped, so a
		 * list with a duplicate exercises the skippedUrls folding. */
		const result = await new Promise<BulkSaveResult>((resolve, reject) => {
			core.once("saved-all-tabs", { success: resolve, failure: reject });
			core.saveAll("tabs", { pages: [{ url: "https://example.com/a" }, { url: "https://example.com/a" }] });
		});

		expect(result.saved).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.skippedUrls).toEqual([
			{ url: "https://example.com/a", code: "already-saved" },
		]);
	});

	it("emits not-logged-in when saving all tabs while logged out", async () => {
		const auth = initInMemoryAuth();
		const readingList = createRecordingReadingList();
		const { shell } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const error = await new Promise<CoreError>((resolve) => {
			core.once("saved-all-tabs", {
				success: () => resolve({ reason: "error", error: new Error("unexpected success") }),
				failure: resolve,
			});
			core.saveAll("tabs", { pages: [{ url: "https://example.com/a" }] });
		});

		expect(error).toEqual({ reason: "not-logged-in" });
		expect(readingList.savePagesCalls).toEqual([]);
	});

	it("opens the save-all-tabs popup from the context menu item", () => {
		const auth = initInMemoryAuth();
		const readingList = createRecordingReadingList();
		const { shell, getOpenSaveAllTabsPopupCount, triggerContextMenu } =
			createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});
		core.init();

		triggerContextMenu({ menuItemId: MENU_ITEM_SAVE_ALL_TABS });

		expect(getOpenSaveAllTabsPopupCount()).toBe(1);
	});

	it("opens the save-all-tabs popup from the keyboard shortcut", () => {
		const auth = initInMemoryAuth();
		const readingList = createRecordingReadingList();
		const { shell, getOpenSaveAllTabsPopupCount, triggerSaveAllTabsShortcut } =
			createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});
		core.init();

		triggerSaveAllTabsShortcut();

		expect(getOpenSaveAllTabsPopupCount()).toBe(1);
	});
});
