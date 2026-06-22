import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryAuth } from "./auth/in-memory-auth";
import { BrowserExtensionCore } from "./core";
import type { ReadingList } from "./core";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
import type { SaveUrl, SaveUrlResult } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";
import type { Auth, GuardedResult, WhenLoggedIn } from "./auth/auth.types";
import { UnauthorizedError } from "./auth/unauthorized-error";
import type { ReadingListItem, ReadingListItemId } from "./domain/reading-list-item.types";

interface FakeShell {
	shell: BrowserShell;
	showSavedCalls: number[];
	showDefaultCalls: number[];
	iconUpdated: Promise<void>;
}

function createFakeShell(
	activeTab: { id?: number; url: string; title: string } | null = null,
): FakeShell {
	const showSavedCalls: number[] = [];
	const showDefaultCalls: number[] = [];
	let resolveIconUpdated!: () => void;
	const iconUpdated = new Promise<void>((resolve) => {
		resolveIconUpdated = resolve;
	});
	const shell: BrowserShell = {
		onShortcutPressed: () => {},
		openPopup: () => {},
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
		onContextMenuClicked: () => {},
		onTabActivated: () => {},
		onTabUpdated: () => {},
	};
	return { shell, showSavedCalls, showDefaultCalls, iconUpdated };
}

type SaveArgs = { url: string; title: string; content?: { bytes: ArrayBuffer; mediaType: string } };

function createRecordingReadingList(
	options: { saveResult?: SaveUrlResult } = {},
): ReadingList & { saveCalls: SaveArgs[] } {
	const inner = initInMemoryReadingList();
	const saveCalls: SaveArgs[] = [];
	const saveUrl: SaveUrl = async (params) => {
		saveCalls.push(params);
		if (options.saveResult) return options.saveResult;
		return inner.saveUrl(params);
	};
	return {
		saveCalls,
		saveUrl,
		removeUrl: inner.removeUrl,
		findByUrl: inner.findByUrl,
		getAllItems: inner.getAllItems,
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

	it("threads captured content through to the reading list", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, iconUpdated } = createFakeShell();
		const core = BrowserExtensionCore(shell, {
			auth,
			logger: HutchLogger.from(noopLogger),
			readingList,
		});

		const content = { bytes: new TextEncoder().encode("<html><body>captured</body></html>").buffer, mediaType: "text/html" };
		core.save("current-tab", {
			url: "https://example.com/article",
			title: "Article",
			content,
			tabId: 42,
		});

		await iconUpdated;
		expect(readingList.saveCalls).toHaveLength(1);
		expect(readingList.saveCalls[0].content).toBe(content);
	});

	it("saves without content when none was captured", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, iconUpdated } = createFakeShell();
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
		expect(readingList.saveCalls).toHaveLength(1);
		expect(readingList.saveCalls[0].content).toBeUndefined();
	});

	it("refreshes the active tab icon when no tabId is provided", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList();
		const { shell, showSavedCalls, showDefaultCalls, iconUpdated } =
			createFakeShell({
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

		await iconUpdated;
		expect(showSavedCalls).toEqual([]);
		expect(showDefaultCalls).toEqual([7]);
	});

	it("does not mark the invoking tab as saved when the result is not saveable", async () => {
		const auth = initInMemoryAuth();
		await auth.login();
		const readingList = createRecordingReadingList({
			saveResult: { ok: false, reason: "not-saveable", items: [] },
		});
		const { shell, showSavedCalls, showDefaultCalls, iconUpdated } =
			createFakeShell({
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

		await iconUpdated;
		expect(showSavedCalls).toEqual([]);
		expect(showDefaultCalls).toEqual([7]);
	});
});

type ShortcutHandler = () => void;
type ContextMenuHandler = (
	info: { menuItemId: string; linkUrl?: string; pageUrl?: string },
	tab?: { url?: string; title?: string },
) => void;
type TabHandler = (tabId: number, url: string) => void;

interface Captured {
	shell: BrowserShell;
	openPopupCalls: Array<{ url: string; title: string }>;
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
	const openPopupCalls: Array<{ url: string; title: string }> = [];
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
		whenLoggedIn,
	};
}

function makeItem(url: string): ReadingListItem {
	return {
		id: "id-1" as ReadingListItemId,
		url,
		title: "Title",
		savedAt: new Date(0),
	};
}

const logger = HutchLogger.from(noopLogger);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
			{ url: "https://shortcut.example", title: "Sc" },
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

describe("BrowserExtensionCore remove/fetch/check", () => {
	it("removes an item and refreshes the icon", async () => {
		const readingList = initInMemoryReadingList();
		const saved = await readingList.saveUrl({ url: "https://r.example", title: "R" });
		assert(saved.ok, "save should succeed for a fresh url");
		const id = saved.item.id;
		const cap = createCapturingShell({
			activeTab: { id: 2, url: "https://r.example", title: "R" },
		});
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const results: unknown[] = [];
		core.on("removed-item", { success: (v) => results.push(v), failure: () => {} });

		core.remove("item", { id });
		await flush();

		expect(results).toHaveLength(1);
		expect(cap.showDefaultCalls).toEqual([2]);
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
		const results: ReadingListItem[][] = [];
		core.on("fetched-reading-list", { success: (v) => results.push(v), failure: () => {} });

		core.fetch("reading-list");
		await flush();

		expect(results).toHaveLength(1);
		expect(results[0]).toHaveLength(1);
	});

	it("checks a url", async () => {
		const readingList = initInMemoryReadingList();
		await readingList.saveUrl({ url: "https://c.example", title: "C" });
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList,
		});
		const results: Array<ReadingListItem | null> = [];
		core.once("checked-url", { success: (v) => results.push(v), failure: () => {} });

		core.check("url", { url: "https://c.example" });
		await flush();

		expect(results).toHaveLength(1);
		expect(results[0]?.url).toBe("https://c.example");
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
		core.once("checked-url", { success: () => {}, failure: (e) => failures.push(e) });

		core.check("url", { url: "https://x.example" });
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
			auth: authReturning({ ok: true, value: makeItem("https://sync.example") }),
			logger,
			readingList: initInMemoryReadingList(),
		});
		const results: Array<ReadingListItem | null> = [];
		core.once("checked-url", { success: (v) => results.push(v), failure: () => {} });

		core.check("url", { url: "https://sync.example" });
		await flush();

		expect(results).toHaveLength(1);
		expect(results[0]?.url).toBe("https://sync.example");
	});

	it("ignores once handler events that are neither success nor failure", () => {
		const cap = createCapturingShell();
		const core = BrowserExtensionCore(cap.shell, {
			auth: loggedInAuth(),
			logger,
			readingList: initInMemoryReadingList(),
		});
		core.once("checked-url", { success: () => {}, failure: () => {} });
		expect(cap.openPopupCalls).toEqual([]);
	});
});
