/* c8 ignore start -- composition root, all browser API glue, tested via Selenium E2E */
import browser from "webextension-polyfill";
import {
	BrowserExtensionCore,
	OAuthTokensSchema,
	initIndexedDbBulkPayloadStore,
	initIndexedDbBulkSaveJobStore,
	initIndexedDbPayloadStore,
	initRecoverableOAuthAuth,
	initIndexedDbAuthState,
	initRefreshProof,
	initSirenReadingList,
	initBulkSaveQueue,
	initBulkSaveRunRecord,
	initSaveAllRuns,
	SaveAllMessageSchema,
	initSyncContextMenus,
	initUploadQueue,
	initOpenHiddenTab,
	initReaderRescue,
	initRescueAttempts,
	initRescueCapture,
	ADVERTISED_CAPABILITIES_STORAGE_KEY,
	COMMAND_BINDINGS_STORAGE_KEY,
	READER_RESCUES_STORAGE_KEY,
	ReaderRescueRequestSchema,
	SAVE_ALL_SHORTCUT_MESSAGE_TYPE,
	SAVE_ALL_TABS_COMMAND,
	commandBindingsFromGetAll,
	type AdvertisedCapabilityStore,
	type BrowserShell,
	type PopupMessage,
	type LoadPageResult,
	captureActiveTabBytes,
	type SaveUrlResult,
	type InvokeActionResult,
	type ReaderRescueAnswer,
	type RescueAttemptStore,
	type Timers,
	type UploadJobStore,
	type UploadQueue,
	type WakeScheduler,
} from "browser-extension-core";
import { initCreateContextMenus } from "./create-context-menus";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import type { BuiltInOAuthClientId } from "@packages/supported-clients";
import { createBrowserSetIcon } from "./action-icon.browser";

const logger = HutchLogger.from(consoleLogger);

function withServiceWorkerKeepalive<T>(work: Promise<T>): Promise<T> {
	void browser.storage.local.get(STORAGE_KEY).catch(() => {});
	const timer = setInterval(() => {
		browser.storage.local.get(STORAGE_KEY).catch(() => {});
	}, 20_000);
	return work.finally(() => clearInterval(timer));
}

const STORAGE_KEY = "hutch_oauth_tokens";
const UPLOAD_JOBS_KEY = "hutch_upload_jobs";
const UPLOAD_ALARM_NAME = "hutch-upload-queue";
const UPLOAD_PAYLOAD_DB = "hutch-upload-payloads";
const BULK_SAVE_JOBS_DB = "hutch-bulk-save-jobs";
const BULK_SAVE_ALARM_NAME = "hutch-bulk-save-queue";
const BULK_SAVE_PAYLOAD_DB = "hutch-bulk-save-payloads";
declare const __SERVER_URL__: string;
const SERVER_URL = __SERVER_URL__;
const CLIENT_ID: BuiltInOAuthClientId = "hutch-chrome-extension";

const uploadJobStore: UploadJobStore = {
	async read(): Promise<unknown> {
		const stored = await browser.storage.local.get(UPLOAD_JOBS_KEY);
		return stored[UPLOAD_JOBS_KEY];
	},
	async write(jobs): Promise<void> {
		await browser.storage.local.set({ [UPLOAD_JOBS_KEY]: jobs });
	},
};

const advertisedCapabilityStore: AdvertisedCapabilityStore = {
	async read(): Promise<unknown> {
		const stored = await browser.storage.local.get(
			ADVERTISED_CAPABILITIES_STORAGE_KEY,
		);
		return stored[ADVERTISED_CAPABILITIES_STORAGE_KEY];
	},
	async write(capabilities): Promise<void> {
		await browser.storage.local.set({
			[ADVERTISED_CAPABILITIES_STORAGE_KEY]: capabilities,
		});
	},
};

const rescueAttemptStore: RescueAttemptStore = {
	async read(): Promise<unknown> {
		const stored = await browser.storage.local.get(READER_RESCUES_STORAGE_KEY);
		return stored[READER_RESCUES_STORAGE_KEY];
	},
	async write(articleIds): Promise<void> {
		await browser.storage.local.set({ [READER_RESCUES_STORAGE_KEY]: articleIds });
	},
};

const syncContextMenus = initSyncContextMenus({
	store: advertisedCapabilityStore,
	registerMenus: initCreateContextMenus(browser.contextMenus),
});

const wakeScheduler: WakeScheduler = {
	now: () => Date.now(),
	async wakeAt(timestamp): Promise<void> {
		browser.alarms.create(UPLOAD_ALARM_NAME, { when: timestamp });
	},
	async cancel(): Promise<void> {
		await browser.alarms.clear(UPLOAD_ALARM_NAME);
	},
};

const bulkSaveWakeScheduler: WakeScheduler = {
	now: () => Date.now(),
	async wakeAt(timestamp): Promise<void> {
		browser.alarms.create(BULK_SAVE_ALARM_NAME, { when: timestamp });
	},
	async cancel(): Promise<void> {
		await browser.alarms.clear(BULK_SAVE_ALARM_NAME);
	},
};

const timers: Timers = {
	after: (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms)),
};


const shell: BrowserShell = {
	onShortcutPressed(_handler) {
		// "shortcut-pressed" is handled in the main onMessage listener below.
	},

	openPopup({ url, title, tabId }) {
		// chrome.action.openPopup() can't accept query params, so hand the
		// target off through session storage. The popup reads-and-removes it
		// on init. Caller MUST be in a user-gesture context (e.g. contextMenus
		// .onClicked) for openPopup to succeed.
		void browser.storage.session.set({ pendingTarget: { url, title, tabId } });
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

	onContextMenuClicked(handler) {
		browser.contextMenus.onClicked.addListener((info) => {
			handler(info);
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
	const proof = initRefreshProof({ crypto, now: Date.now, uuid: () => crypto.randomUUID() });
	const store = await initIndexedDbAuthState({
		indexedDB,
		async loadLegacy() {
			const raw = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
			const parsed = OAuthTokensSchema.safeParse(raw);
			return parsed.success ? parsed.data : null;
		},
		removeLegacy: () => browser.storage.local.remove(STORAGE_KEY),
		createKey: proof.createKey,
		uuid: () => crypto.randomUUID(),
	});
	const auth = await initRecoverableOAuthAuth({
		store, proof,
		keepAlive: withServiceWorkerKeepalive,
		client: "chrome",
		version: browser.runtime.getManifest().version,
		contextId: crypto.randomUUID(),
		now: Date.now,
		uuid: () => crypto.randomUUID(),
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
		logger,
	});

	const readingList = initSirenReadingList({
		serverUrl: SERVER_URL,
		getAccessToken: auth.getAccessToken,
		fetchFn: (...args) => fetch(...args),
		refreshTokens: auth.refreshTokens,
		onUnauthorized: async (accessToken) => {
			void runs.forget();
			await auth.resourceRejected(accessToken);
			void uploadQueue.purge();
		},
		logger,
		onAdvertisedActions: (names) => {
			syncContextMenus
				.capabilitiesDiscovered(names)
				.catch((err) => logger.error("Failed to sync context menus", err));
		},
	});

	const uploadQueue = initUploadQueue({
		jobs: uploadJobStore,
		payloads: initIndexedDbPayloadStore({ databaseName: UPLOAD_PAYLOAD_DB }),
		scheduler: wakeScheduler,
		capture: (target) => captureTabContent(target),
		uploadContent: readingList.uploadContent,
		logger,
	});

	const bulkSaveRunRecord = initBulkSaveRunRecord({ area: browser.storage.session, logger });

	const bulkSaveQueue = initBulkSaveQueue({
		jobs: initIndexedDbBulkSaveJobStore({ databaseName: BULK_SAVE_JOBS_DB }),
		payloads: initIndexedDbBulkPayloadStore({ databaseName: BULK_SAVE_PAYLOAD_DB }),
		scheduler: bulkSaveWakeScheduler,
		openSession: readingList.openBulkSaveSession,
		progress: (events) => bulkSaveRunRecord.applyEvents(events),
		logger,
	});

	const runs = initSaveAllRuns({
		record: bulkSaveRunRecord,
		queue: bulkSaveQueue,
		whenLoggedIn: auth.whenLoggedIn,
		capture: (tab) => captureTabContent(tab).catch(() => undefined),
		notify: showBulkSaveNotification,
		keepAlive: withServiceWorkerKeepalive,
		logger,
	});

	const readerRescue = initReaderRescue({
		attempts: initRescueAttempts({ store: rescueAttemptStore }),
		capture: initRescueCapture({
			openHiddenTab: initOpenHiddenTab({ tabs: browser.tabs, timers, captureTimeoutMs: CAPTURE_HTML_TIMEOUT_MS }),
			timers,
			loadTimeoutMs: RESCUE_LOAD_TIMEOUT_MS,
			logger,
		}),
		enqueueCaptured: uploadQueue.enqueueCaptured,
		logger,
	});

	const core = BrowserExtensionCore(shell, {
		auth,
		logger,
		readingList: { ...readingList, saveUrl: runs.saveUrlSettlingRun(readingList.saveUrl) },
	});

	core.on("pre-init", () => {
		syncContextMenus
			.applyCached()
			.catch((err) => logger.error("Failed to restore context menus", err));
	});

	core.init();

	return { core, uploadQueue, runs, auth, readerRescue };
}

const appPromise = initCore();

function resumeUploads(): void {
	appPromise
		.then(({ uploadQueue }) => withServiceWorkerKeepalive(uploadQueue.resume()))
		.catch((err) => logger.error("Failed to resume deferred uploads", err));
}

function resumeBulkSaves(): void {
	appPromise
		.then(({ runs }) => withServiceWorkerKeepalive(runs.resumeAll()))
		.catch((err) => logger.error("Failed to resume deferred bulk saves", err));
}

/** Starting the worker re-runs this module top level, so this call already
 * covers every startup and install; only an alarm-driven wake needs a listener
 * of its own. */
resumeUploads();
resumeBulkSaves();
browser.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === UPLOAD_ALARM_NAME) resumeUploads();
	if (alarm.name === BULK_SAVE_ALARM_NAME) resumeBulkSaves();
});

/** Chrome publishes no event for a shortcut being rebound, so the worker's own
 * wake is the only refresh point the content scripts can be given. */
function refreshCommandBindings(): void {
	browser.commands
		.getAll()
		.then((commands) =>
			browser.storage.local.set({
				[COMMAND_BINDINGS_STORAGE_KEY]: commandBindingsFromGetAll(commands),
			}),
		)
		.catch((err) => logger.error("Failed to read command shortcuts", err));
}

refreshCommandBindings();

browser.commands.onCommand.addListener((command) => {
	if (command === SAVE_ALL_TABS_COMMAND) shell.openSaveAllTabsPopup();
});

/** The job carries the tab URL verbatim: substituting anything else (a canonical
 * URL, a redirect target) would land the bytes on a different article than the one
 * the user just saw appear. The popup's response is already on its way, so the
 * worker is held open for the capture and upload that follow it. */
function readlistContentUpload(
	uploadQueue: UploadQueue,
	target: { url: string; title: string; tabId?: number },
): void {
	void withServiceWorkerKeepalive(uploadQueue.enqueue(target));
}

const CAPTURE_HTML_TIMEOUT_MS = 5000;
const RESCUE_LOAD_TIMEOUT_MS = 30_000;

async function captureTabHtml(
	tabId: number | undefined,
	url: string,
): Promise<string | undefined> {
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
		if (typeof rawHtml === "string" && rawHtml.length > 0) return rawHtml;
	}
	return undefined;
}

/** Best-effort content capture for one tab: the live DOM via the content script,
 * else a byte fetch in the user's session, else undefined. `captureTabHtml`
 * refuses a tab that has navigated away from `url`, which is what keeps the
 * bytes attached to the article the save actually created. */
async function captureTabContent(tab: { url: string; tabId?: number }): Promise<{ bytes: ArrayBuffer; mediaType: string } | undefined> {
	const rawHtml = await captureTabHtml(tab.tabId, tab.url);
	if (rawHtml) return { bytes: new TextEncoder().encode(rawHtml).buffer, mediaType: "text/html" };
	return captureActiveTabBytes({ tabUrl: tab.url, fetchFn: fetch, logger });
}

function hasStringType(value: unknown): value is { type: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

function showBulkSaveNotification(notification: {
	title: string;
	message: string;
}): void {
	browser.notifications
		.create({
			type: "basic",
			iconUrl: browser.runtime.getURL("icons/light/icon-128.png"),
			title: notification.title,
			message: notification.message,
		})
		.catch((err) => logger.error("Failed to show bulk save notification", err));
}

browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
	if ((raw as { type: string }).type === "shortcut-pressed") {
		browser.action.openPopup().catch((err) => logger.error(err));
		return;
	}

	if (hasStringType(raw) && raw.type === SAVE_ALL_SHORTCUT_MESSAGE_TYPE) {
		shell.openSaveAllTabsPopup();
		return;
	}

	const rescue = ReaderRescueRequestSchema.safeParse(raw);
	if (rescue.success) {
		const { url, articleId, trigger } = rescue.data;
		const openerTabId = sender.tab?.id;
		appPromise
			.then(async ({ auth, readerRescue }) => {
				const guarded = auth.whenLoggedIn(() => readerRescue({ url, articleId, trigger, openerTabId }));
				if (!guarded.ok) {
					sendResponse({ outcome: "skipped", reason: "not-logged-in" } satisfies ReaderRescueAnswer);
					return;
				}
				const { answer, completion } = await guarded.value;
				sendResponse(answer);
				await withServiceWorkerKeepalive(completion);
			})
			.catch((err) => logger.error("Failed to rescue the reader's article", err));
		return true;
	}

	const saveAll = SaveAllMessageSchema.safeParse(raw);
	if (saveAll.success) {
		appPromise
			.then(({ runs }) => runs.handle(saveAll.data))
			.catch((err) => {
				logger.error("Failed to handle a save-all message", err);
				return { ok: false, reason: "error" };
			})
			.then(sendResponse);
		return true;
	}

	const message = raw as PopupMessage;

	appPromise
		.then(({ core, uploadQueue, runs, auth }) => {
			switch (message.type) {
				case "login-prompt-shown": {
					auth.reportLoginPrompt().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
					break;
				}
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
					/** Page bytes captured for a signed-in reader must not outlive the
					 * session that authorised capturing them, so the worker is held open
					 * until the purge lands and the popup is answered only then. */
					const purged = withServiceWorkerKeepalive(
						Promise.all([uploadQueue.purge(), runs.forget()]),
					);
					core.logout();
					purged.then(() => sendResponse({ ok: true }));
					break;
				}
				case "save-current-tab": {
					const target = {
						url: message.url,
						title: message.title,
						tabId: message.tabId,
					};
					const pending = new Promise<unknown>((resolve) => {
						core.once("saved-current-tab", {
							success: (value: SaveUrlResult) => {
								if (value.ok) readlistContentUpload(uploadQueue, target);
								resolve({ ok: true, value });
							},
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					core.save("current-tab", target);
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
				case "get-all-items":
				case "load-page":
				case "load-sort": {
					const pending = new Promise<unknown>((resolve) => {
						core.once("fetched-reading-list", {
							success: (value: LoadPageResult) =>
								resolve({ ok: true, value }),
							failure: (err) => resolve({ ok: false, ...err }),
						});
					});
					if (message.type === "load-page") {
						core.fetch("reading-list", { page: message.index });
					} else if (message.type === "load-sort") {
						core.fetch("reading-list", { sort: message.index });
					} else {
						core.fetch("reading-list");
					}
					pending.then(sendResponse);
					break;
				}
			}
		});

	return true;
});
/* c8 ignore stop */
