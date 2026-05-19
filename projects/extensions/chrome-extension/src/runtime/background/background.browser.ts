/* c8 ignore start -- composition root, all browser API glue, tested via Selenium E2E */
// (test 3/4 probe: chrome-only edit must publish chrome but skip firefox)
import browser from "webextension-polyfill";
import {
	BrowserExtensionCore,
	initOAuthAuth,
	initSirenReadingList,
	type BrowserShell,
	type OAuthTokens,
	type PopupMessage,
	type ReadingListItem,
	type SaveUrlResult,
	type RemoveUrlResult,
	type TokenStorage,
} from "browser-extension-core";
import { initCreateContextMenus } from "./create-context-menus";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createBrowserSetIcon } from "./tinted-icon.browser";

const logger = HutchLogger.from(consoleLogger);

const STORAGE_KEY = "hutch_oauth_tokens";
declare const __SERVER_URL__: string;
const SERVER_URL = __SERVER_URL__;
const CLIENT_ID = "hutch-chrome-extension";

const tokenStorage: TokenStorage = {
	async getTokens(): Promise<OAuthTokens | null> {
		const result = await browser.storage.local.get(STORAGE_KEY);
		const raw = result[STORAGE_KEY];
		if (!raw) return null;
		return raw as OAuthTokens;
	},
	async setTokens(tokens: OAuthTokens): Promise<void> {
		await browser.storage.local.set({ [STORAGE_KEY]: tokens });
	},
	async clearTokens(): Promise<void> {
		await browser.storage.local.remove(STORAGE_KEY);
	},
};

let popupWindow: { id: number } | null = null;
let openingPopup: Promise<void> = Promise.resolve();

const shell: BrowserShell = {
	onShortcutPressed(handler) {
		browser.runtime.onMessage.addListener((raw, _sender) => {
			if ((raw as { type: string }).type === "shortcut-pressed") {
				handler();
			}
			return undefined;
		});
	},

	openPopup({ url, title }) {
		const params = `?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
		openingPopup = openingPopup.then(() => {
			const closeExisting = popupWindow
				? browser.windows.remove(popupWindow.id).catch(() => {})
				: Promise.resolve();
			return closeExisting
				.then(() => browser.windows.create({
					url: browser.runtime.getURL(
						`popup/popup.template.html${params}`,
					),
					type: "popup",
					width: 380,
					height: 520,
				}))
				.then((win) => {
					if (win.id != null) {
						popupWindow = { id: win.id };
					}
				})
				.catch((err) => logger.error(err));
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

	onPopupClosed(handler) {
		browser.windows.onRemoved.addListener((windowId) => {
			if (popupWindow && windowId === popupWindow.id) {
				popupWindow = null;
				handler();
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

async function captureActiveTabHtml(): Promise<string | undefined> {
	const tabs = await browser.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];
	if (tab?.id == null) return undefined;
	const tabId = tab.id;
	const captured = await Promise.race([
		browser.tabs.sendMessage(tabId, { type: "capture-html" }),
		new Promise<undefined>((resolve) =>
			setTimeout(() => resolve(undefined), CAPTURE_HTML_TIMEOUT_MS),
		),
	]).catch(() => undefined);
	if (captured && typeof captured === "object" && "rawHtml" in captured) {
		const rawHtml = (captured as { rawHtml: unknown }).rawHtml;
		if (typeof rawHtml === "string" && rawHtml.length > 0) return rawHtml;
	}
	return undefined;
}

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "shortcut-pressed") {
		return;
	}

	if ((raw as { target?: string }).target === "offscreen") {
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
					captureActiveTabHtml()
						.then((rawHtml) => {
							core.save("current-tab", {
								url: message.url,
								title: message.title,
								rawHtml,
							});
						})
						.catch(() => {
							core.save("current-tab", {
								url: message.url,
								title: message.title,
							});
						});
					pending.then(sendResponse);
					break;
				}
				case "remove-item": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("removed-item", {
							success: (value: RemoveUrlResult) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.remove("item", { id: message.id });
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
			}
		});

	return true;
});
/* c8 ignore stop */
