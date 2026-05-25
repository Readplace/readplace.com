/* c8 ignore start -- composition root, all browser API glue, tested via Selenium E2E */
// (test 4/4 probe: firefox-only edit must publish firefox but skip chrome)
import {
	BrowserExtensionCore,
	initOAuthAuth,
	initSirenReadingList,
	MENU_ITEM_SAVE_PAGE,
	MENU_ITEM_SAVE_LINK,
	type BrowserShell,
	type OAuthTokens,
	type PopupMessage,
	type ReadingListItem,
	type SaveUrlResult,
	type RemoveUrlResult,
	type TokenStorage,
} from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createBrowserSetIcon } from "./tinted-icon.browser";

const logger = HutchLogger.from(consoleLogger);

const STORAGE_KEY = "hutch_oauth_tokens";
declare const __SERVER_URL__: string;
const SERVER_URL = __SERVER_URL__;
const CLIENT_ID = "hutch-firefox-extension";

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

const shell: BrowserShell = {
	onShortcutPressed(_handler) {
		// "shortcut-pressed" is handled in the main onMessage listener below.
	},

	openPopup({ url, title }) {
		// browserAction.openPopup() can't accept query params, so hand the
		// target off through session storage. The popup reads-and-removes it
		// on init. Caller MUST be in a user-gesture context (e.g. menus
		// .onClicked) for openPopup to succeed.
		void browser.storage.session.set({ pendingTarget: { url, title } });
		browser.browserAction.openPopup().catch(async (err) => {
			await browser.storage.session.remove("pendingTarget").catch(() => {});
			logger.error(err);
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

	createContextMenus() {
		browser.menus.create({
			id: MENU_ITEM_SAVE_PAGE,
			title: "Save Page to Readplace",
			contexts: ["page"],
		});
		browser.menus.create({
			id: MENU_ITEM_SAVE_LINK,
			title: "Save Link to Readplace",
			contexts: ["link"],
		});
	},

	onContextMenuClicked(handler) {
		browser.menus.onClicked.addListener((info, tab) => {
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
const MAX_PDF_BYTES = 500 * 1024 * 1024;
const PDF_MAGIC_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PDF_FETCH_TIMEOUT_MS = 30000;

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

function looksLikePdfBytes(bytes: Uint8Array): boolean {
	if (bytes.length < PDF_MAGIC_BYTES.length) return false;
	for (let i = 0; i < PDF_MAGIC_BYTES.length; i += 1) {
		if (bytes[i] !== PDF_MAGIC_BYTES[i]) return false;
	}
	return true;
}

/**
 * Best-effort PDF byte capture from the user's browser context. Fires only
 * when the HTML content-script capture returned empty (the typical signal
 * that the tab is rendering a native PDF viewer instead of a DOM). The
 * fetch uses the user's session cookies and real TLS fingerprint via
 * activeTab, so bot-defended origins (CIA Reading Room, Adobe DAM, Fastly-
 * fronted PDFs) accept it where a server-side crawl gets rejected. Any
 * failure (network error, non-PDF body, oversize) returns undefined and
 * the caller falls back to the URL-only save-article path.
 */
async function captureActiveTabPdf(tabUrl: string): Promise<ArrayBuffer | undefined> {
	try {
		const response = await fetch(tabUrl, {
			credentials: "include",
			signal: AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const contentType = response.headers.get("content-type") ?? "";
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return undefined;
		const looksPdf =
			contentType.includes("application/pdf") ||
			contentType.includes("application/x-pdf") ||
			looksLikePdfBytes(new Uint8Array(buffer, 0, PDF_MAGIC_BYTES.length));
		if (!looksPdf) return undefined;
		return buffer;
	} catch {
		return undefined;
	}
}

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
	if ((raw as { type: string }).type === "shortcut-pressed") {
		browser.browserAction.openPopup().catch((err) => logger.error(err));
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
						.then(async (rawHtml) => {
							/** Empty HTML capture is the browser's signal that the
							 * tab isn't a DOM page — typically a native PDF viewer.
							 * Try fetching the bytes from the user's session before
							 * falling back to the URL-only save path. Any failure
							 * (network, non-PDF, oversize) short-circuits below. */
							const pdfBytes = rawHtml
								? undefined
								: await captureActiveTabPdf(message.url);
							core.save("current-tab", {
								url: message.url,
								title: message.title,
								rawHtml,
								pdfBytes,
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
