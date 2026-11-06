import type { ReadingListItemId } from "./domain/reading-list-item.types";
import type { Auth, GuardedResult } from "./auth/auth.types";
import type { SaveUrlResult, InvokeActionResult, SaveUrl, InvokeAction, FindByUrl, GetItems, LoadPage, LoadPageResult, LoadSort, CollectionPage } from "./reading-list/reading-list.types";
import type { BrowserShell } from "./shell.types";
import type { Logger } from "@packages/logger";
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
	getItems: GetItems;
	loadPage: LoadPage;
	loadSort: LoadSort;
}

export type LoginReply = { ok: true } | { ok: false; reason: "error"; error: Error };

export interface Core {
	init(): void;

	login(): Promise<LoginReply>;
	logout(): void;
	save(resource: "current-tab", data: { url: string; title: string; tabId?: number }): Promise<GuardedResult<SaveUrlResult>>;
	invoke(resource: "item-action", data: { id: ReadingListItemId; name: string }): Promise<GuardedResult<InvokeActionResult>>;
	fetch(resource: "reading-list"): Promise<GuardedResult<CollectionPage>>;
	fetch(resource: "reading-list", data: { page: number } | { sort: number }): Promise<GuardedResult<LoadPageResult>>;

	on(event: "pre-init" | "post-init" | "logged-out", handler: () => void): void;
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

function settle<T>(guarded: GuardedResult<T>): Promise<GuardedResult<Awaited<T>>> {
	if (!guarded.ok) return Promise.resolve(guarded);
	return Promise.resolve(guarded.value).then(
		(value): GuardedResult<Awaited<T>> => ({ ok: true, value }),
		(err: unknown): GuardedResult<Awaited<T>> =>
			err instanceof UnauthorizedError
				? { ok: false, reason: "not-logged-in" }
				: { ok: false, reason: "error", error: toError(err) },
	);
}

export function BrowserExtensionCore(shell: BrowserShell, deps: { auth: Auth; logger: Logger; readingList: ReadingList }): Core {
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

	async function updateActiveTabIcon() {
		const tab = await shell.getActiveTab();
		if (tab?.id != null) {
			await updateIconForTab(tab.id, tab.url);
		}
	}

	/** A per-item mutation changes one article; the icon answers a different
	 * question — whether the tab the reader is looking at is saved. Only when
	 * those are the same article can the answer have changed, so every other
	 * mutation leaves the icon alone and costs nothing. */
	async function updateIconForMutatedUrl(url: string) {
		const tab = await shell.getActiveTab();
		if (tab?.id == null || tab.url !== url) return;
		await updateIconForTab(tab.id, tab.url);
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

	function fetchReadingList(resource: "reading-list"): Promise<GuardedResult<CollectionPage>>;
	function fetchReadingList(resource: "reading-list", data: { page: number } | { sort: number }): Promise<GuardedResult<LoadPageResult>>;
	function fetchReadingList(_resource: "reading-list", data?: { page: number } | { sort: number }): Promise<GuardedResult<LoadPageResult>> {
		const guarded = auth.whenLoggedIn((): Promise<LoadPageResult> => {
			if (!data) return readingList.getItems();
			return "sort" in data
				? readingList.loadSort({ index: data.sort })
				: readingList.loadPage({ index: data.page });
		});
		const settled = settle(guarded);
		if (guarded.ok) establishWebSession();
		return settled;
	}

	return {
		init() {
			eventBus.emit("pre-init");

			shell.onContextMenuClicked((info) => {
				if (info.menuItemId === MENU_ITEM_SAVE_ALL_TABS) {
					shell.openSaveAllTabsPopup();
					return;
				}
				const target = getContextMenuTarget(info);
				if (!target) return;
				shell.openPopup(target);
			});

			shell.onShortcutPressed(() => {
				getShortcutTarget()
					.then((target) => {
						if (!target) return;
						shell.openPopup(target);
					})
					.catch((err) => logger.error("Failed to open the popup for the shortcut target", { error: err }));
			});

			shell.onTabActivated((tabId, url) => {
				updateIconForTab(tabId, url).catch((err) =>
					logger.error("Failed to update icon for activated tab", { error: err }),
				);
			});

			shell.onTabUpdated((tabId, url) => {
				updateIconForTab(tabId, url).catch((err) =>
					logger.error("Failed to update icon for updated tab", { error: err }),
				);
			});

			eventBus.emit("post-init");
		},

		login() {
			return auth.login().then(
				(): LoginReply => {
					updateActiveTabIcon().catch(() => {});
					return { ok: true };
				},
				(err: unknown): LoginReply => ({ ok: false, reason: "error", error: toError(err) }),
			);
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
				saveCurrentTab({ url: data.url, title: data.title }),
			);
			const settled = settle(guarded);
			if (guarded.ok) {
				const { tabId } = data;
				guarded.value
					.then(async (result) => {
						if (!result.ok) {
							establishWebSession();
							return;
						}
						/** The save's own outcome already says what the icon should show,
						 * so it is set from that. Re-deriving it would make the client ask
						 * the server to answer what this response has answered — a list
						 * request the reader never triggered. A target that carries no tab
						 * (a saved link, or one opened without one) is worth no request at
						 * all: the icon simply stays as the tab last left it. */
						if (tabId != null) await shell.setIcon.showSaved(tabId);
					})
					.catch((err) => logger.error("Failed to update icon after save", { error: err }));
			}
			return settled;
		},

		invoke(_resource, data) {
			const guarded = auth.whenLoggedIn(() =>
				readingList.invokeAction({ id: data.id, name: data.name }),
			);
			const settled = settle(guarded);
			if (guarded.ok) {
				guarded.value
					.then(async (result) => {
						if (result.ok) await updateIconForMutatedUrl(result.targetUrl);
					})
					.catch(() => {});
			}
			return settled;
		},

		fetch: fetchReadingList,

		on(event, handler) {
			eventBus.on(event, handler);
		},
	};
}
