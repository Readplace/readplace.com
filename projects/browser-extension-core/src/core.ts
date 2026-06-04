import type { ReadingListItem, ReadingListItemId } from "./domain/reading-list-item.types";
import type { Auth, GuardedResult } from "./auth/auth.types";
import type { SaveUrlResult, RemoveUrlResult, SaveUrl, RemoveUrl, FindByUrl, GetAllItems } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";
import type { HutchLogger } from "@packages/hutch-logger";
import { createEventBus } from "./event-bus";
import { UnauthorizedError } from "./auth/unauthorized-error";
import { initSaveCurrentTab } from "./save-current-tab";
import { initIconStatus } from "./icon-status";
import { initGetContextMenuTarget } from "./get-context-menu-target";
import { initGetShortcutTarget } from "./handle-shortcut-command";

export interface ReadingList {
	saveUrl: SaveUrl;
	removeUrl: RemoveUrl;
	findByUrl: FindByUrl;
	getAllItems: GetAllItems;
}

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
		data: { url: string; title: string; rawHtml?: string; pdfBytes?: ArrayBuffer },
	): void;
	remove(resource: "item", data: { id: ReadingListItemId }): void;
	fetch(resource: "reading-list"): void;
	check(resource: "url", data: { url: string }): void;

	on(event: "pre-init", handler: () => void): void;
	on(event: "post-init", handler: () => void): void;
	on(event: "logged-in", handler: ResultCallbacks<void>): void;
	on(event: "logged-out", handler: () => void): void;
	on(event: "saved-current-tab", handler: ResultCallbacks<SaveUrlResult>): void;
	on(event: "removed-item", handler: ResultCallbacks<RemoveUrlResult>): void;
	on(event: "fetched-reading-list", handler: ResultCallbacks<ReadingListItem[]>): void;
	on(event: "checked-url", handler: ResultCallbacks<ReadingListItem | null>): void;

	once(event: "logged-in", handler: ResultCallbacks<void>): void;
	once(event: "saved-current-tab", handler: ResultCallbacks<SaveUrlResult>): void;
	once(event: "removed-item", handler: ResultCallbacks<RemoveUrlResult>): void;
	once(event: "fetched-reading-list", handler: ResultCallbacks<ReadingListItem[]>): void;
	once(event: "checked-url", handler: ResultCallbacks<ReadingListItem | null>): void;
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
			eventBus.emit(event, "failure", { reason: guardedResult.reason } as CoreError);
			return;
		}
		const value = guardedResult.value;
		if (value instanceof Promise) {
			value
				.then((resolved) => eventBus.emit(event, "success", resolved))
				.catch((err: unknown) => {
					if (err instanceof UnauthorizedError) {
						eventBus.emit(event, "failure", { reason: "not-logged-in" } as CoreError);
						return;
					}
					const error = err instanceof Error ? err : new Error(String(err));
					eventBus.emit(event, "failure", { reason: "error", error } as CoreError);
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

	return {
		init() {
			eventBus.emit("pre-init");

			shell.onContextMenuClicked((info, tab) => {
				const target = getContextMenuTarget(info, tab);
				if (!target) return;
				shell.openPopup({ url: target.url, title: target.title });
			});

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
					eventBus.emit("logged-in", "failure", { reason: "error", error } as CoreError);
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
					rawHtml: data.rawHtml,
					pdfBytes: data.pdfBytes,
				}),
			);
			emitResult("saved-current-tab", guarded);
			if (guarded.ok) {
				guarded.value.then(() => updateActiveTabIcon()).catch(() => {});
			}
		},

		remove(_resource, data) {
			const guarded = auth.whenLoggedIn(() =>
				readingList.removeUrl(data.id),
			);
			emitResult("removed-item", guarded);
			if (guarded.ok) {
				guarded.value.then(() => updateActiveTabIcon()).catch(() => {});
			}
		},

		fetch(_resource) {
			const guarded = auth.whenLoggedIn(() => readingList.getAllItems());
			emitResult("fetched-reading-list", guarded);
		},

		check(_resource, data) {
			const guarded = auth.whenLoggedIn(() => readingList.findByUrl(data.url));
			emitResult("checked-url", guarded);
		},

		// biome-ignore lint/suspicious/noExplicitAny: implementation signature must accept all overloaded handler shapes
		on(event: string, handler: any) {
			if (typeof handler === "function") {
				eventBus.on(event, handler);
			} else {
				const resultHandler = handler as ResultCallbacks<unknown>;
				eventBus.on(event, (type: unknown, value: unknown) => {
					if (type === "success") {
						resultHandler.success(value);
					} else if (type === "failure") {
						resultHandler.failure(value as CoreError);
					}
				});
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: implementation signature must accept all overloaded handler shapes
		once(event: string, handler: any) {
			const resultHandler = handler as ResultCallbacks<unknown>;
			eventBus.once(event, (type: unknown, value: unknown) => {
				if (type === "success") {
					resultHandler.success(value);
				} else if (type === "failure") {
					resultHandler.failure(value as CoreError);
				}
			});
		},
	};
}
