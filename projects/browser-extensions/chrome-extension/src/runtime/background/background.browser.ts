/* c8 ignore start -- composition root, all browser API glue, tested via Selenium E2E */
import browser from "webextension-polyfill";
import {
	BrowserExtensionCore,
	initOAuthAuth,
	initSirenReadingList,
	type BrowserShell,
	type OAuthTokens,
	OAuthTokensSchema,
	type PopupMessage,
	type ReadingListItem,
	captureActiveTabBytes,
	type SavePhase,
	type SaveUrlResult,
	type InvokeActionResult,
	type BulkSaveResult,
	type BulkSavePage,
	type SaveableTab,
	type TokenStorage,
} from "browser-extension-core";
import { initCreateContextMenus } from "./create-context-menus";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import type { BuiltInOAuthClientId } from "@packages/supported-clients";
import { createBrowserSetIcon } from "./action-icon.browser";

const logger = HutchLogger.from(consoleLogger);

function withServiceWorkerKeepalive<T>(work: Promise<T>): Promise<T> {
	const timer = setInterval(() => {
		browser.storage.local.get(STORAGE_KEY).catch(() => {});
	}, 20_000);
	return work.finally(() => clearInterval(timer));
}

const STORAGE_KEY = "hutch_oauth_tokens";
declare const __SERVER_URL__: string;
const SERVER_URL = __SERVER_URL__;
const CLIENT_ID: BuiltInOAuthClientId = "hutch-chrome-extension";

const tokenStorage: TokenStorage = {
	async getTokens(): Promise<OAuthTokens | null> {
		const result = await browser.storage.local.get(STORAGE_KEY);
		const raw = result[STORAGE_KEY];
		if (!raw) return null;
		const parsed = OAuthTokensSchema.safeParse(raw);
		return parsed.success ? parsed.data : null;
	},
	async setTokens(tokens: OAuthTokens): Promise<void> {
		await browser.storage.local.set({ [STORAGE_KEY]: tokens });
	},
	async clearTokens(): Promise<void> {
		await browser.storage.local.remove(STORAGE_KEY);
	},
};

const shell: BrowserShell = {
	onShortcutPressed(_handler) {
		// "shortcut-pressed" is handled in the main onMessage listener below.
	},

	openPopup({ url, title }) {
		// chrome.action.openPopup() can't accept query params, so hand the
		// target off through session storage. The popup reads-and-removes it
		// on init. Caller MUST be in a user-gesture context (e.g. contextMenus
		// .onClicked) for openPopup to succeed.
		void browser.storage.session.set({ pendingTarget: { url, title } });
		browser.action.openPopup().catch(async (err) => {
			await browser.storage.session.remove("pendingTarget").catch(() => {});
			logger.error(err);
		});
	},

	openSaveAllTabsPopup() {
		// The popup reads-and-removes this marker on init to enter bulk mode.
		// Caller MUST be in a user-gesture context for openPopup to succeed.
		void browser.storage.session.set({ pendingBulkSave: true });
		browser.action.openPopup().catch(async (err) => {
			await browser.storage.session.remove("pendingBulkSave").catch(() => {});
			logger.error(err);
		});
	},

	onSaveAllTabsShortcut(handler) {
		browser.commands.onCommand.addListener((command) => {
			if (command === "save-all-tabs") handler();
		});
	},

	getActiveTab: async () => {
		const tabs = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});
		const tab = tabs[0];
		if (!tab?.url) return null;
		return { id: tab.id, url: tab.url, title: tab.title ?? tab.url };
	},

	queryActiveTabs: () =>
		browser.tabs.query({ active: true, currentWindow: true }),

	setIcon: createBrowserSetIcon(),

	createContextMenus: initCreateContextMenus(browser.contextMenus),

	onContextMenuClicked(handler) {
		browser.contextMenus.onClicked.addListener((info, tab) => {
			handler(info, tab);
		});
	},

	onTabActivated(handler) {
		browser.tabs.onActivated.addListener((activeInfo) => {
			browser.tabs
				.get(activeInfo.tabId)
				.then((tab) => {
					if (tab.url) {
						handler(activeInfo.tabId, tab.url);
					}
				})
				.catch(() => {});
		});
	},

	onTabUpdated(handler) {
		browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
			if (changeInfo.url) {
				handler(tabId, changeInfo.url);
			}
		});
	},

};

async function initCore() {
	const auth = await initOAuthAuth({
		serverUrl: SERVER_URL,
		clientId: CLIENT_ID,
		async openTab(url: string): Promise<number> {
			const tab = await browser.tabs.create({ url });
			if (tab.id == null) throw new Error("Created tab has no id");
			return tab.id;
		},
		waitForRedirect({ tabId, urlPrefix }): Promise<string> {
			return new Promise((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer);
					browser.tabs.onUpdated.removeListener(listener);
				};
				const listener = (
					updatedTabId: number,
					changeInfo: { url?: string },
				) => {
					if (updatedTabId === tabId && changeInfo.url?.startsWith(urlPrefix)) {
						cleanup();
						resolve(changeInfo.url);
					}
				};
				const timer = setTimeout(() => {
					cleanup();
					reject(new Error("OAuth login timed out after 5 minutes"));
				}, 5 * 60 * 1000);
				browser.tabs.onUpdated.addListener(listener);
			});
		},
		async closeTab(tabId: number): Promise<void> {
			await browser.tabs.remove(tabId);
		},
		fetchFn: (...args) => fetch(...args),
		tokenStorage,
		logger,
	});

	const readingList = initSirenReadingList({
		serverUrl: SERVER_URL,
		getAccessToken: auth.getAccessToken,
		fetchFn: (...args) => fetch(...args),
		onUnauthorized: auth.logout,
		logger,
	});

	const core = BrowserExtensionCore(shell, { auth, logger, readingList });

	core.on("pre-init", () => {
		shell.createContextMenus();
	});

	core.init();

	return core;
}

const corePromise = initCore();

const CAPTURE_HTML_TIMEOUT_MS = 5000;

async function captureTabHtml(
	tabId: number | undefined,
	url: string,
): Promise<{ rawHtml: string; canonicalUrl?: string } | undefined> {
	if (tabId == null) return undefined;
	const tab = await browser.tabs.get(tabId).catch(() => undefined);
	if (!tab || tab.url !== url) return undefined;
	const captured = await Promise.race([
		browser.tabs.sendMessage(tabId, { type: "capture-html" }),
		new Promise<undefined>((resolve) =>
			setTimeout(() => resolve(undefined), CAPTURE_HTML_TIMEOUT_MS),
		),
	]).catch(() => undefined);
	if (captured && typeof captured === "object" && "rawHtml" in captured) {
		const rawHtml = (captured as { rawHtml: unknown }).rawHtml;
		if (typeof rawHtml === "string" && rawHtml.length > 0) {
			const rawCanonical = (captured as { canonicalUrl?: unknown }).canonicalUrl;
			const canonicalUrl =
				typeof rawCanonical === "string" && rawCanonical.length > 0 ? rawCanonical : undefined;
			return { rawHtml, canonicalUrl };
		}
	}
	return undefined;
}

/** Best-effort content capture for one tab: the live DOM via the content script,
 * else a byte fetch in the user's session, else undefined (a URL-only save). */
async function captureTabContent(tab: { url: string; tabId?: number }): Promise<{ bytes: ArrayBuffer; mediaType: string } | undefined> {
	const captured = await captureTabHtml(tab.tabId, tab.url);
	if (captured) return { bytes: new TextEncoder().encode(captured.rawHtml).buffer, mediaType: "text/html" };
	return captureActiveTabBytes({ tabUrl: tab.url, fetchFn: fetch, logger });
}

/** Captures every saveable tab into a bulk page; a tab that can't be captured
 * (unscriptable, discarded, fetch refused) becomes a URL-only page. */
async function capturePages(tabs: SaveableTab[]): Promise<BulkSavePage[]> {
	return Promise.all(
		tabs.map(async (tab) => {
			const content = await captureTabContent(tab).catch(() => undefined);
			const page: BulkSavePage = { url: tab.url, title: tab.title };
			if (content) page.content = content;
			return page;
		}),
	);
}

function broadcastSaveProgress(phase: SavePhase): void {
	// .catch: the popup is the only receiver and may have closed mid-save.
	browser.runtime.sendMessage({ type: "save-progress", phase }).catch(() => {});
}

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "shortcut-pressed") {
		browser.action.openPopup().catch((err) => logger.error(err));
		return;
	}

	const message = raw as PopupMessage;

	corePromise
		.then((core) => {
			switch (message.type) {
				case "login": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("logged-in", {
							success: () => resolve({ ok: true }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.login();
					pending.then(sendResponse);
					break;
				}
				case "logout": {
					core.logout();
					sendResponse({ ok: true });
					break;
				}
				case "save-current-tab": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("saved-current-tab", {
							success: (value: SaveUrlResult) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					broadcastSaveProgress("capturing");
					captureTabHtml(message.tabId, message.url)
						.then(async (captured) => {
							broadcastSaveProgress("uploading");
							const content = captured
								? { bytes: new TextEncoder().encode(captured.rawHtml).buffer, mediaType: "text/html" }
								: await captureActiveTabBytes({ tabUrl: message.url, fetchFn: fetch, logger });
							core.save("current-tab", {
								url: captured?.canonicalUrl ?? message.url,
								title: message.title,
								content,
								tabId: message.tabId,
							});
						})
						.catch(() => {
							broadcastSaveProgress("uploading");
							core.save("current-tab", {
								url: message.url,
								title: message.title,
								tabId: message.tabId,
							});
						});
					withServiceWorkerKeepalive(pending).then(sendResponse);
					break;
				}
				case "invoke-action": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("invoked-item-action", {
							success: (value: InvokeActionResult) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.invoke("item-action", { id: message.id, name: message.name });
					pending.then(sendResponse);
					break;
				}
				case "check-url": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("checked-url", {
							success: (value: ReadingListItem | null) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.check("url", { url: message.url });
					pending.then(sendResponse);
					break;
				}
				case "get-all-items": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("fetched-reading-list", {
							success: (value: ReadingListItem[]) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.fetch("reading-list");
					pending.then(sendResponse);
					break;
				}
				case "save-all-tabs": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("saved-all-tabs", {
							success: (value: BulkSaveResult) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					const { tabs } = message;
					capturePages(tabs)
						.then((pages) => core.saveAll("tabs", { pages }))
						.catch(() =>
							core.saveAll("tabs", { pages: tabs.map((tab) => ({ url: tab.url, title: tab.title })) }),
						);
					pending.then(sendResponse);
					break;
				}
			}
		});

	return true;
});
/* c8 ignore stop */
