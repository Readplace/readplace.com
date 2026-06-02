import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryAuth } from "./auth/in-memory-auth";
import { BrowserExtensionCore } from "./core";
import type { ReadingList } from "./core";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
import type { SaveUrl, SaveUrlResult } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";

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

type SaveArgs = { url: string; title: string; rawHtml?: string };

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

	it("threads captured rawHtml through to the reading list", async () => {
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
			rawHtml: "<html><body>captured</body></html>",
			tabId: 42,
		});

		await iconUpdated;
		expect(readingList.saveCalls).toEqual([
			{
				url: "https://example.com/article",
				title: "Article",
				rawHtml: "<html><body>captured</body></html>",
			},
		]);
	});

	it("saves URL-only (no rawHtml) when no HTML was captured", async () => {
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
		expect(readingList.saveCalls[0].rawHtml).toBeUndefined();
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
