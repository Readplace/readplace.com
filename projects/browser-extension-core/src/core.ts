import type { ReadingListItem, ReadingListItemId } from "./domain/reading-list-item.types";
import type { Auth, GuardedResult } from "./auth/auth.types";
import type { SaveUrlResult, InvokeActionResult, SaveUrl, InvokeAction, FindByUrl, GetAllItems, SaveUrls, BulkSaveResult } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";
import type { HutchLogger } from "@packages/hutch-logger";
import { createEventBus } from "./event-bus";
import { UnauthorizedError } from "./auth/unauthorized-error";
import { initSaveCurrentTab } from "./save-current-tab";
import { initIconStatus } from "./icon-status";
import { initGetContextMenuTarget, MENU_ITEM_SAVE_ALL_TABS } from "./get-context-menu-target";
import { initGetShortcutTarget } from "./handle-shortcut-command";

export interface ReadingList {
	saveUrl: SaveUrl;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getAllItems: GetAllItems;
	saveUrls: SaveUrls;
}

/** A single save-articles request is capped server-side at
 * MAX_URLS_PER_BULK_SAVE (500). saveAll batches well below that so a window with
 * more saveable tabs than the cap saves across several requests instead of one
 * the server rejects with a generic error, and an empty window makes zero
 * requests and folds to a `Saved 0` summary. Must stay ≤ the server cap. */
export const BULK_SAVE_BATCH_SIZE = 100;

export type ResultCallbacks<T> = {
	success: (value: T) => void;
	failure: (error: CoreError) => void;
};

export type CoreError =
	| { reason: "not-logged-in" }
	| { reason: "error"; error: Error };

export interface Core {
	init(): void;

	login(): void;
	logout(): void;
	save(
		resource: "current-tab",
		data: { url: string; title: string; content?: { bytes: ArrayBuffer; mediaType: string }; tabId?: number },
	): void;
	invoke(resource: "item-action", data: { id: ReadingListItemId; name: string }): void;
	fetch(resource: "reading-list"): void;
	check(resource: "url", data: { url: string }): void;
	saveAll(resource: "tabs", data: { urls: string[] }): void;

	on(event: "pre-init", handler: () => void): void;
	on(event: "post-init", handler: () => void): void;
	on(event: "logged-in", handler: ResultCallbacks<void>): void;
	on(event: "logged-out", handler: () => void): void;
	on(event: "saved-current-tab", handler: ResultCallbacks<SaveUrlResult>): void;
	on(event: "invoked-item-action", handler: ResultCallbacks<InvokeActionResult>): void;
	on(event: "fetched-reading-list", handler: ResultCallbacks<ReadingListItem[]>): void;
	on(event: "checked-url", handler: ResultCallbacks<ReadingListItem | null>): void;
	on(event: "saved-all-tabs", handler: ResultCallbacks<BulkSaveResult>): void;

	once(event: "logged-in", handler: ResultCallbacks<void>): void;
	once(event: "saved-current-tab", handler: ResultCallbacks<SaveUrlResult>): void;
	once(event: "invoked-item-action", handler: ResultCallbacks<InvokeActionResult>): void;
	once(event: "fetched-reading-list", handler: ResultCallbacks<ReadingListItem[]>): void;
	once(event: "checked-url", handler: ResultCallbacks<ReadingListItem | null>): void;
	once(event: "saved-all-tabs", handler: ResultCallbacks<BulkSaveResult>): void;
}

export function BrowserExtensionCore(shell: BrowserShell, deps: { auth: Auth; logger: HutchLogger; readingList: ReadingList }): Core {
	const logger = deps.logger;
	const eventBus = createEventBus();
	const auth = deps.auth;
	const readingList = deps.readingList;
	const saveCurrentTab = initSaveCurrentTab({ saveUrl: readingList.saveUrl });
	const { updateIconForTab } = initIconStatus({
		findByUrl: readingList.findByUrl,
		whenLoggedIn: auth.whenLoggedIn,
		setIcon: shell.setIcon,
	});
	const getContextMenuTarget = initGetContextMenuTarget();
	const getShortcutTarget = initGetShortcutTarget({
		queryActiveTabs: shell.queryActiveTabs,
	});

	function emitResult<T>(event: string, guardedResult: GuardedResult<T>): void;
	function emitResult<T>(event: string, guardedResult: GuardedResult<Promise<T>>): void;
	function emitResult<T>(event: string, guardedResult: GuardedResult<T | Promise<T>>): void {
		if (!guardedResult.ok) {
			const { ok: _ok, ...failure } = guardedResult;
			eventBus.emit(event, "failure", failure satisfies CoreError);
			return;
		}
		const value = guardedResult.value;
		if (value instanceof Promise) {
			value
				.then((resolved) => eventBus.emit(event, "success", resolved))
				.catch((err: unknown) => {
					if (err instanceof UnauthorizedError) {
						eventBus.emit(event, "failure", { reason: "not-logged-in" } satisfies CoreError);
						return;
					}
					const error = err instanceof Error ? err : new Error(String(err));
					eventBus.emit(event, "failure", { reason: "error", error } satisfies CoreError);
				});
		} else {
			eventBus.emit(event, "success", value);
		}
	}

	async function updateActiveTabIcon() {
		const tab = await shell.getActiveTab();
		if (tab?.id != null) {
			await updateIconForTab(tab.id, tab.url);
		}
	}

	/** Mint the browser session cookie so a reader link (/queue/:id/view, whose
	 * owner is resolved from the hutch_sid cookie, never the bearer) opens the
	 * private reader instead of the public /view. Fired whenever the popup is about
	 * to surface reader links — the list load and the not-saveable drop-into-list.
	 * Fire-and-forget: a failure only degrades that one navigation to the public page. */
	function establishWebSession(): void {
		auth
			.ensureWebSession()
			.catch((error) => logger.warn("Failed to mint web session for reader links", error));
	}

	async function saveUrlsInBatches(urls: string[]): Promise<BulkSaveResult> {
		const summary: BulkSaveResult = { saved: 0, skipped: 0, failed: 0, skippedUrls: [] };
		for (let i = 0; i < urls.length; i += BULK_SAVE_BATCH_SIZE) {
			const batch = await readingList.saveUrls({
				urls: urls.slice(i, i + BULK_SAVE_BATCH_SIZE),
			});
			summary.saved += batch.saved;
			summary.skipped += batch.skipped;
			summary.failed += batch.failed;
			summary.skippedUrls.push(...batch.skippedUrls);
		}
		return summary;
	}

	return {
		init() {
			eventBus.emit("pre-init");

			shell.onContextMenuClicked((info, tab) => {
				if (info.menuItemId === MENU_ITEM_SAVE_ALL_TABS) {
					shell.openSaveAllTabsPopup();
					return;
				}
				const target = getContextMenuTarget(info, tab);
				if (!target) return;
				shell.openPopup({ url: target.url, title: target.title });
			});

			shell.onSaveAllTabsShortcut(() => shell.openSaveAllTabsPopup());

			shell.onShortcutPressed(() => {
				getShortcutTarget()
					.then((target) => {
						if (!target) return;
						shell.openPopup({ url: target.url, title: target.title });
					})
					.catch((err) => logger.error(err));
			});

			shell.onTabActivated((tabId, url) => {
				updateIconForTab(tabId, url).catch(() => {});
			});

			shell.onTabUpdated((tabId, url) => {
				updateIconForTab(tabId, url).catch(() => {});
			});

			eventBus.emit("post-init");
		},

		login() {
			auth.login()
				.then(() => {
					eventBus.emit("logged-in", "success", undefined);
					updateActiveTabIcon().catch(() => {});
				})
				.catch((err: unknown) => {
					const error = err instanceof Error ? err : new Error(String(err));
					eventBus.emit("logged-in", "failure", { reason: "error", error } satisfies CoreError);
				});
		},

		logout() {
			auth.logout()
				.then(() => {
					eventBus.emit("logged-out");
					updateActiveTabIcon().catch(() => {});
				})
				.catch(() => {});
		},

		save(_resource, data) {
			const guarded = auth.whenLoggedIn(() =>
				saveCurrentTab({
					url: data.url,
					title: data.title,
					content: data.content,
				}),
			);
			emitResult("saved-current-tab", guarded);
			if (guarded.ok) {
				const { tabId } = data;
				guarded.value
					.then((result) => {
						if (!result.ok) establishWebSession();
						return tabId != null && result.ok
							? shell.setIcon.showSaved(tabId)
							: updateActiveTabIcon();
					})
					.catch(() => {});
			}
		},

		invoke(_resource, data) {
			const guarded = auth.whenLoggedIn(() =>
				readingList.invokeAction({ id: data.id, name: data.name }),
			);
			emitResult("invoked-item-action", guarded);
			if (guarded.ok) {
				guarded.value.then(() => updateActiveTabIcon()).catch(() => {});
			}
		},

		fetch(_resource) {
			const guarded = auth.whenLoggedIn(() => readingList.getAllItems());
			emitResult("fetched-reading-list", guarded);
			if (guarded.ok) establishWebSession();
		},

		check(_resource, data) {
			const guarded = auth.whenLoggedIn(() => readingList.findByUrl(data.url));
			emitResult("checked-url", guarded);
		},

		saveAll(_resource, data) {
			const guarded = auth.whenLoggedIn(() => saveUrlsInBatches(data.urls));
			emitResult("saved-all-tabs", guarded);
		},

		// biome-ignore lint/suspicious/noExplicitAny: implementation signature must accept all overloaded handler shapes
		on(event: string, handler: any) {
			if (typeof handler === "function") {
				eventBus.on(event, handler);
			} else {
				eventBus.on(event, (type: unknown, value: unknown) => {
					if (type === "success") {
						handler.success(value);
					} else if (type === "failure") {
						handler.failure(value);
					}
				});
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: implementation signature must accept all overloaded handler shapes
		once(event: string, handler: any) {
			eventBus.once(event, (type: unknown, value: unknown) => {
				if (type === "success") {
					handler.success(value);
				} else if (type === "failure") {
					handler.failure(value);
				}
			});
		},
	};
}
