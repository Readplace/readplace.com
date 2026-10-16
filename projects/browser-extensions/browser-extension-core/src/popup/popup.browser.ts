/// <reference lib="dom" />
import type { HutchLogger } from "@packages/hutch-logger";
import { type IconName, iconSvg } from "@packages/ui-icons";
import { advertisesBulkSave } from "../advertised-capabilities";
import type { GuardedResult } from "../auth/auth.types";
import { BULK_SAVE_FAILED_TITLE } from "../bulk-save-notification";
import {
	type ContentShortcuts,
	DEFAULT_SAVE_ALL_SHORTCUT,
	DEFAULT_SAVE_SHORTCUT,
	commandBindingsFromGetAll,
	matchesShortcut,
	resolveShortcut,
	shortcutHintSegments,
} from "../command-shortcuts";
import type { ReadingListItem } from "../domain/reading-list-item.types";
import { installShortcuts } from "../keydown-shortcuts";
import type { PopupMessage } from "../popup-message.types";
import type {
	BulkSaveResult,
	CollectionPage,
	CollectionTotal,
	InvokeActionResult,
	LoadPageResult,
	Message,
	PageDescriptor,
	SaveUrlResult,
	SortDescriptor,
} from "../reading-list/reading-list.types";
import { ADVERTISED_CAPABILITIES_STORAGE_KEY, parseStoredCapabilities } from "../sync-context-menus";
import { type ActionVariant, actionLabel, actionVariant, linkLabel, linkPresentation } from "./action-affordance";
import { filterByQuery } from "./filter-by-query";
import { isAppUrl } from "./is-app-url";
import { isMacPlatform } from "./is-mac-platform";
import { buildListHeaderView } from "./list-header-view";
import { buildMessageView } from "./message-view";
import { LIST_SKELETON_DELAY_MS, initPaintAfterDelay } from "./paint-after-delay";
import { type PaginationView, buildPaginationView } from "./pagination-view";
import { type PendingTarget, parsePendingTarget } from "./pending-target";
import {
	SAVE_ALL_RENDERED_MARK,
	type SaveAllDetailLine,
	buildSaveAllDetailLines,
	classifyTabs,
	saveAllTabsLabel,
	summarizeBulkSave,
} from "./save-all-tabs";
import { type RowFactKind, rowFacts } from "./row-facts";
import { SAVE_RENDERED_MARK, buildSavedView } from "./saved-view";

interface PopupBrowser {
	runtime: { sendMessage: (message: unknown) => Promise<unknown> };
	storage: {
		session: {
			get: (key: string) => Promise<Record<string, unknown>>;
			remove: (key: string) => Promise<void>;
		};
		local: { get: (key: string) => Promise<Record<string, unknown>> };
	};
	tabs: {
		query: (queryInfo: { active?: boolean; currentWindow?: boolean }) => Promise<
			{ id?: number; url?: string; title?: string }[]
		>;
	};
	commands: { getAll: () => Promise<readonly { name?: string; shortcut?: string }[]> };
}

/** The client's own presentation map: an action variant -> the popup's CSS
 * class. The server never sends a class; the variant comes from mapping the
 * action `name` client-side (actionVariant), and an unknown name falls back to
 * the default. */
const ACTION_CLASS_BY_VARIANT: Record<ActionVariant, string> = {
	toggle: "btn btn--secondary btn--s list-view__action list-view__control",
	default: "btn btn--neutral btn--s list-view__control",
};

const FACT_CLASS: Record<RowFactKind, string> = {
	site: "list-view__fact list-view__fact--site",
	saved: "list-view__fact list-view__fact--saved",
};

const DETAIL_LINE_CLASS: Record<SaveAllDetailLine["kind"], string> = {
	failed: "save-all-view__failed-item",
	skipped: "save-all-view__failed-item",
	more: "save-all-view__failed-item save-all-view__failed-item--more",
};

const DETAIL_MARKER_CLASS: Partial<Record<SaveAllDetailLine["kind"], string>> = {
	failed: "save-all-view__marker save-all-view__marker--failed",
	skipped: "save-all-view__marker save-all-view__marker--skipped",
};

type ListError = { title: string; body: string; retry?: () => void };

type CollectionRequest = Extract<PopupMessage, { type: "load-page" | "load-sort" }>;

function elementById(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`${id} element not found`);
	return element;
}

function iconElement(input: { name: IconName; className: string }): HTMLSpanElement {
	const holder = document.createElement("span");
	holder.className = input.className;
	holder.setAttribute("aria-hidden", "true");
	holder.innerHTML = iconSvg(input.name);
	return holder;
}

function screenReaderText(text: string): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = "sr-only";
	span.textContent = text;
	return span;
}

function inFlightDots(): HTMLSpanElement {
	const dots = document.createElement("span");
	dots.className = "in-flight-dots";
	dots.setAttribute("aria-hidden", "true");
	for (let index = 0; index < 3; index += 1) dots.appendChild(document.createElement("span"));
	return dots;
}

function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

export function initPopup(deps: {
	browser: PopupBrowser;
	appDomains: readonly string[];
	logger: HutchLogger;
	views: string;
}): void {
	const { browser, appDomains, logger } = deps;

	document.body.innerHTML = deps.views;
	document.body.classList.remove("popup-shell");

	const suppressed: ContentShortcuts = {
		save: DEFAULT_SAVE_SHORTCUT,
		saveAll: DEFAULT_SAVE_ALL_SHORTCUT,
	};

	installShortcuts(document, [
		{ matches: (event) => suppressed.save !== null && matchesShortcut(suppressed.save)(event) },
		{ matches: (event) => suppressed.saveAll !== null && matchesShortcut(suppressed.saveAll)(event) },
	]);

	function showView(id: string) {
		document.querySelectorAll<HTMLElement>(".view").forEach((view) => {
			view.hidden = true;
		});
		elementById(id).hidden = false;
	}

	const paintAfterDelay = initPaintAfterDelay({
		setTimeoutFn: (callback, ms) => window.setTimeout(callback, ms),
		clearTimeoutFn: (id) => window.clearTimeout(id),
		delayMs: LIST_SKELETON_DELAY_MS,
	});

	/** Isolated boundary wrapper: the single contained assertion for the untyped
	 * response, so call sites stay free of `as`. */
	function send<T>(message: PopupMessage): Promise<T> {
		return browser.runtime.sendMessage(message) as Promise<T>;
	}

	async function performLogout() {
		await send({ type: "logout" });
		showLoginPrompt();
	}

	function showLoginPrompt() {
		showView("login-view");
		void send({ type: "login-prompt-shown" }).catch(() => {});
	}

	function isNotLoggedIn(result: { ok: boolean; reason?: string }): boolean {
		return !result.ok && result.reason === "not-logged-in";
	}

	let currentItems: ReadingListItem[] = [];
	let pageList: PageDescriptor[] = [];
	let currentTotal: CollectionTotal | undefined;
	let currentSort: SortDescriptor[] = [];
	let listBusy = false;

	function adoptCollection(page: CollectionPage): void {
		currentItems = page.items;
		pageList = page.pages;
		currentTotal = page.total;
		currentSort = page.sort;
	}

	async function whileListPending<T>(work: () => Promise<T>): Promise<T> {
		const linkList = elementById("link-list");
		const pagination = elementById("pagination");
		linkList.classList.add("list-view__links--pending");
		linkList.setAttribute("aria-busy", "true");
		pagination.classList.add("pagination--pending");
		try {
			return await work();
		} finally {
			linkList.classList.remove("list-view__links--pending");
			linkList.setAttribute("aria-busy", "false");
			pagination.classList.remove("pagination--pending");
		}
	}

	function stepControl(step: {
		className: string;
		icon: IconName;
		label: string;
		target: number | undefined;
	}): HTMLElement {
		const icon = iconElement({ name: step.icon, className: "pagination__step-icon" });
		const label = screenReaderText(step.label);
		const target = step.target;
		if (target === undefined) {
			const disabled = document.createElement("span");
			disabled.className = `pagination__step ${step.className} pagination__step--disabled`;
			disabled.setAttribute("aria-disabled", "true");
			disabled.append(icon, label);
			return disabled;
		}
		const button = document.createElement("button");
		button.type = "button";
		button.className = `pagination__step ${step.className}`;
		button.append(icon, label);
		button.addEventListener("click", () => {
			void followCollection({ type: "load-page", index: target });
		});
		return button;
	}

	function showPressedPage(pressed: HTMLElement): void {
		const pagination = elementById("pagination");
		for (const current of Array.from(pagination.querySelectorAll(".pagination__page--current"))) {
			current.classList.remove("pagination__page--current");
			current.removeAttribute("aria-current");
		}
		pressed.classList.add("pagination__page--current");
	}

	function renderPagination(view: PaginationView) {
		const pagination = elementById("pagination");

		pagination.replaceChildren();
		pagination.hidden = view.hidden;
		if (view.hidden) return;

		pagination.appendChild(
			stepControl({
				className: "pagination__step--previous",
				icon: "chevron-left",
				label: "Previous page",
				target: view.previous,
			}),
		);

		for (const page of view.pages) {
			if ("gap" in page) {
				const gap = document.createElement("span");
				gap.className = "pagination__gap";
				gap.append(iconElement({ name: "ellipsis", className: "pagination__gap-icon" }), screenReaderText("…"));
				pagination.appendChild(gap);
				continue;
			}
			if (page.active) {
				const current = document.createElement("span");
				current.className = "pagination__page pagination__page--current";
				current.setAttribute("aria-current", "page");
				current.textContent = page.label;
				pagination.appendChild(current);
				continue;
			}
			const pageButton = document.createElement("button");
			pageButton.type = "button";
			pageButton.className = "pagination__page";
			pageButton.textContent = page.label;
			pageButton.addEventListener("click", () => {
				if (listBusy) return;
				showPressedPage(pageButton);
				void followCollection({ type: "load-page", index: page.index });
			});
			pagination.appendChild(pageButton);
		}

		pagination.appendChild(
			stepControl({
				className: "pagination__step--next",
				icon: "chevron-right",
				label: "Next page",
				target: view.next,
			}),
		);
	}

	function renderRow(item: ReadingListItem): HTMLElement {
		const row = document.createElement("div");
		row.className = "list-view__row";

		const itemLink = document.createElement("a");
		itemLink.className = "list-view__item";
		itemLink.target = "_blank";
		itemLink.rel = "noopener noreferrer";

		const title = document.createElement("span");
		title.className = "list-view__item-title";
		title.textContent = item.title;
		title.title = item.title;

		const meta = document.createElement("span");
		meta.className = "list-view__meta";

		for (const fact of rowFacts(item)) {
			const factElement = document.createElement("span");
			factElement.className = FACT_CLASS[fact.kind];
			factElement.title = fact.text;
			const text = document.createElement("span");
			text.className = "list-view__fact-text";
			text.textContent = fact.text;
			factElement.append(iconElement({ name: fact.iconName, className: "list-view__fact-icon" }), text);
			meta.appendChild(factElement);
		}

		itemLink.append(title, meta);
		row.appendChild(itemLink);

		const controls = document.createElement("div");
		controls.className = "list-view__controls";

		// One control per advertised SEMANTIC link — loop the item's link
		// descriptors generically. `read` (row-anchor presentation) drives the
		// row's primary open anchor; any other semantic rel renders as a standalone
		// link control, so a future rel (e.g. `summary`) renders with no popup
		// change. Presentation comes from the one client-side rel map, never a
		// per-rel `if`.
		for (const link of item.links) {
			if (linkPresentation(link.rel) === "row-anchor") {
				itemLink.href = link.href;
				continue;
			}
			const control = document.createElement("a");
			control.className = "btn btn--neutral btn--s list-view__control";
			control.href = link.href;
			control.target = "_blank";
			control.rel = "noopener noreferrer";
			control.textContent = linkLabel(link);
			controls.appendChild(control);
		}

		// One control per advertised affordance — loop the item's action
		// descriptors and render a button each. No per-capability boolean and no
		// hardcoded "does the client know action X" check, so a newly-advertised
		// server action renders here with no popup change.
		for (const action of item.actions) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = ACTION_CLASS_BY_VARIANT[actionVariant(action.name)];
			const label = actionLabel(action);
			const content = document.createElement("span");
			content.className = "list-view__control-label";
			content.setAttribute("aria-hidden", "true");
			content.textContent = label;
			button.append(content, screenReaderText(label), inFlightDots());
			button.addEventListener("click", async () => {
				if (listBusy) return;
				listBusy = true;
				button.classList.add("list-view__control--pending");
				try {
					await whileListPending(async () => {
						const result = await send<GuardedResult<InvokeActionResult>>({
							type: "invoke-action",
							id: item.id,
							name: action.name,
						});

						if (isNotLoggedIn(result)) {
							showLoginPrompt();
							return;
						}

						if (result.ok && result.value.ok) {
							/** The mutation answered with the list as it now stands, page list
							 * and all, so the reader lands wherever that answer says — there is
							 * no page counter here to reconcile against it. */
							adoptCollection(result.value);
							renderLinks(filterItems());
						} else if (result.ok) {
							/** not-found: the item was removed elsewhere or the server no
							 * longer advertises this action. Reload so the stale phantom row
							 * drops instead of lingering until the popup is reopened. */
							await loadAllItems();
						} else {
							/** Generic failure (server 5xx / transient network) — the
							 * not-logged-in case already returned above. The action didn't
							 * apply and the row is unchanged, so surface an error. */
							setListError({
								title: `Couldn't ${lowerFirst(label)}`,
								body: "Nothing changed. Try again.",
							});
						}
					});
				} finally {
					button.classList.remove("list-view__control--pending");
					listBusy = false;
				}
			});
			controls.appendChild(button);
		}

		if (controls.childElementCount > 0) row.appendChild(controls);
		return row;
	}

	function renderListHeader(): void {
		const view = buildListHeaderView({ total: currentTotal, sort: currentSort });
		const header = elementById("list-header");
		const count = header.querySelector(".list-view__count");
		if (!count) throw new Error("list count element not found");
		count.textContent = view.countLabel ?? "";

		const sortButton = elementById("sort-button");
		const sort = view.sort;
		sortButton.replaceChildren();
		sortButton.onclick = null;
		sortButton.hidden = sort === null;
		if (sort !== null) {
			sortButton.append(sort.label, iconElement({ name: sort.iconName, className: "list-view__sort-icon" }));
			sortButton.onclick = () => {
				void followCollection({ type: "load-sort", index: sort.toggleIndex });
			};
		}

		header.hidden = view.countLabel === null && sort === null;
	}

	function renderLinks(items: ReadingListItem[]) {
		const linkList = elementById("link-list");
		const emptyList = elementById("empty-list");
		const noMatches = elementById("no-matches");
		const search = document.querySelector<HTMLElement>(".list-view__search");
		if (!search) throw new Error("list search element not found");

		linkList.replaceChildren();
		emptyList.hidden = true;
		noMatches.hidden = true;
		setListError(null);

		if (currentItems.length === 0) {
			search.hidden = true;
			elementById("list-header").hidden = true;
			emptyList.hidden = false;
			renderPagination(buildPaginationView([]));
			return;
		}

		search.hidden = false;
		renderListHeader();

		if (items.length === 0) {
			noMatches.hidden = false;
			renderPagination(buildPaginationView(visiblePageList()));
			return;
		}

		for (const item of items) {
			linkList.appendChild(renderRow(item));
		}

		renderPagination(buildPaginationView(visiblePageList()));
	}

	function filterQuery(): string {
		const filterInput = document.getElementById("filter-input");
		if (!(filterInput instanceof HTMLInputElement)) throw new Error("filter-input element not found");
		return filterInput.value;
	}

	function filterItems(): ReadingListItem[] {
		return filterByQuery(currentItems, filterQuery());
	}

	/** No pager while a filter is on: the filter searches the page in hand, so
	 * offering the other pages would promise the reader results from pages it never
	 * looked at. */
	function visiblePageList(): PageDescriptor[] {
		return filterQuery() === "" ? pageList : [];
	}

	async function loadAllItems(): Promise<"loaded" | "failed" | "logged-out"> {
		const result = await send<GuardedResult<CollectionPage>>({
			type: "get-all-items",
		});

		if (isNotLoggedIn(result)) {
			showLoginPrompt();
			return "logged-out";
		}

		if (!result.ok) {
			setListError(listLoadFailed());
			return "failed";
		}

		adoptCollection(result.value);
		renderLinks(filterItems());
		return "loaded";
	}

	async function followCollection(request: CollectionRequest): Promise<void> {
		if (listBusy) return;
		listBusy = true;
		try {
			await whileListPending(() => fetchCollection(request));
		} finally {
			listBusy = false;
			renderPagination(buildPaginationView(visiblePageList()));
		}
	}

	async function fetchCollection(request: CollectionRequest): Promise<void> {
		const result = await send<GuardedResult<LoadPageResult>>(request);

		if (isNotLoggedIn(result)) {
			showLoginPrompt();
			return;
		}

		if (!result.ok) {
			setListError(listLoadFailed());
			return;
		}

		if ("pageList" in result.value) {
			await loadAllItems();
			return;
		}

		adoptCollection(result.value);
		renderLinks(filterItems());
	}

	function setListWarning(message: string | null): void {
		const warningEl = elementById("list-warning");
		const messageEl = warningEl.querySelector(".alert__message");
		if (!messageEl) throw new Error("list warning message element not found");
		messageEl.textContent = message ?? "";
		warningEl.hidden = !message;
	}

	// Each caller passes its own message so the surface never shows a stale one — a
	// failed action and a failed load read differently. Error counterpart of
	// setListWarning.
	function setListError(error: ListError | null): void {
		elementById("list-error-title").textContent = error === null ? "" : error.title;
		elementById("list-error-body").textContent = error === null ? "" : error.body;
		const retryButton = elementById("list-error-retry");
		retryButton.onclick = error?.retry ?? null;
		retryButton.hidden = error?.retry === undefined;
		elementById("list-error").hidden = error === null;
	}

	function listLoadFailed(): ListError {
		return {
			title: "Couldn't load your articles",
			body: "Your saved articles are still there.",
			retry: () => {
				void showListView().catch(showListLoadFailure);
			},
		};
	}

	function setSaveFailure(retry: (() => void) | null): void {
		elementById("saving-view").setAttribute("aria-busy", String(retry === null));
		elementById("saving-progress").hidden = retry !== null;
		elementById("saving-status").hidden = retry !== null;
		elementById("save-failure").hidden = retry === null;
		elementById("save-retry-button").onclick = retry;
	}

	function showSaving(): void {
		setSaveFailure(null);
		showView("saving-view");
	}

	function showListLoadFailure(error: unknown): void {
		logger.error("Failed to initialize popup:", error);
		showView("list-view");
		setListError(listLoadFailed());
	}

	// Server-driven messages: the extension knows only how to render them, never
	// what they mean. A shared helper makes every rendering decision; this glue
	// only paints it. The body is server-authored HTML, injected as HTML and
	// trusted by contract.
	function renderMessages(messages: Message[]): void {
		const container = document.getElementById("messages");
		if (!container) return;
		const view = buildMessageView(messages);
		container.replaceChildren();
		container.setAttribute("role", view.role);
		for (const item of view.items) {
			const alert = document.createElement("div");
			alert.className = item.className;
			const content = document.createElement("div");
			content.className = "alert__content";
			const message = document.createElement("div");
			message.className = "alert__message";
			message.innerHTML = item.html;
			content.appendChild(message);
			alert.append(iconElement({ name: item.iconName, className: "alert__icon" }), content);
			container.appendChild(alert);
		}
		container.hidden = view.hidden;
	}

	/** Paints the outcome the server described: its messages, then one control per
	 * semantic link it offered. Nothing here is client-authored copy, and only the
	 * reader choosing the list surface fetches the collection. */
	function renderSavedView(saved: { item: ReadingListItem; messages: Message[] }): void {
		const lines = document.getElementById("saved-messages");
		if (lines) {
			lines.replaceChildren();
			for (const line of buildSavedView(saved.messages)) {
				const el = document.createElement("p");
				el.className = line.className;
				el.innerHTML = line.html;
				lines.appendChild(el);
			}
		}
		const affordances = document.getElementById("saved-affordances");
		if (!affordances) return;
		affordances.replaceChildren();
		for (const link of saved.item.links) {
			const presentation = linkPresentation(link.rel);
			if (presentation === "row-anchor") continue;
			const control =
				presentation === "list-view"
					? document.createElement("button")
					: document.createElement("a");
			control.className = "btn btn--neutral";
			control.textContent = linkLabel(link);
			if (control instanceof HTMLAnchorElement) {
				control.href = link.href;
				control.target = "_blank";
				control.rel = "noopener noreferrer";
			} else {
				control.type = "button";
				control.addEventListener("click", () => {
					void showListView().catch(showListLoadFailure);
				});
			}
			affordances.appendChild(control);
		}
	}

	async function loadThenRevealList(): Promise<void> {
		const outcome = await paintAfterDelay({
			paint: () => showView("list-skeleton-view"),
			load: loadAllItems,
		});
		if (outcome === "logged-out") return;
		showView("list-view");
	}

	async function showListView() {
		setListWarning(null);
		renderMessages([]);
		await loadThenRevealList();
	}

	async function getActiveTab(): Promise<PendingTarget | null> {
		const stored = await browser.storage.session.get("pendingTarget");
		const pending = parsePendingTarget(stored.pendingTarget);
		if (pending) {
			await browser.storage.session.remove("pendingTarget").catch(() => {});
			return pending;
		}

		const params = new URLSearchParams(window.location.search);
		const paramUrl = params.get("url");
		if (paramUrl) return { url: paramUrl, title: params.get("title") ?? paramUrl };

		const tabs = await browser.tabs.query({ active: true, currentWindow: true });
		const tab = tabs[0];
		if (!tab?.url) return null;
		return { url: tab.url, title: tab.title ?? tab.url, tabId: tab.id };
	}

	async function saveAndShowList() {
		const activeTab = await getActiveTab();
		if (!activeTab) throw new Error("No active tab or URL parameters");

		if (isAppUrl({ tabUrl: activeTab.url, appDomains })) {
			showView("list-skeleton-view");
			await showListView();
			return;
		}

		await saveTarget(activeTab);
	}

	async function saveTarget(target: PendingTarget) {
		showSaving();

		let saveResult: GuardedResult<SaveUrlResult>;
		try {
			saveResult = await send<GuardedResult<SaveUrlResult>>({
				type: "save-current-tab",
				url: target.url,
				title: target.title,
				tabId: target.tabId,
			});
		} catch (error) {
			logger.error("Failed to save the current tab:", error);
			setSaveFailure(() => void saveTarget(target));
			return;
		}

		if (isNotLoggedIn(saveResult)) {
			showLoginPrompt();
			return;
		}

		if (!saveResult.ok) {
			setSaveFailure(() => void saveTarget(target));
			return;
		}

		if (saveResult.value.ok) {
			renderSavedView(saveResult.value);
			showView("saved-view");
			performance.mark(SAVE_RENDERED_MARK);
			return;
		}

		if ("reason" in saveResult.value && saveResult.value.reason === "not-saveable") {
			adoptCollection(saveResult.value);
			showView("list-view");
			renderMessages([]);
			setListWarning(saveResult.value.warning?.message ?? null);
			renderLinks(filterItems());
		}

		if ("messages" in saveResult.value) {
			/** Interceptor: the server refused the save with messages to show.
			 * Render them and drop the user into their list — existing items stay
			 * manageable, but the new link was not saved. The two server-message
			 * channels are mutually exclusive, so clear the warning one. */
			setListWarning(null);
			renderMessages(saveResult.value.messages);
			await loadThenRevealList();
		}
	}

	function paintSaveAllSummary(element: HTMLElement, summary: string): void {
		element.replaceChildren();
		summary.split(" \u00B7 ").forEach((fact, index) => {
			if (index > 0) element.append(" \u00B7 ");
			const span = document.createElement("span");
			span.className = "save-all-view__fact";
			span.textContent = fact;
			element.append(span);
		});
	}

	function renderSaveAllDetailLines(list: HTMLElement, lines: SaveAllDetailLine[]): void {
		for (const line of lines) {
			const item = document.createElement("li");
			item.className = DETAIL_LINE_CLASS[line.kind];
			const markerClass = DETAIL_MARKER_CLASS[line.kind];
			if (markerClass !== undefined) item.appendChild(iconElement({ name: "x", className: markerClass }));
			const text = document.createElement("span");
			text.textContent = line.text;
			item.appendChild(text);
			list.append(item);
		}
		list.hidden = lines.length === 0;
	}

	async function saveAllTabsFlow() {
		showView("save-all-view");
		const tabs = await browser.tabs.query({ currentWindow: true });
		const { saveable, skipReasons } = classifyTabs(tabs, appDomains);

		const progressEl = elementById("save-all-progress");
		const titleEl = elementById("save-all-title");
		const summaryEl = elementById("save-all-summary");
		const tooBigEl = elementById("save-all-too-big");
		const failedListEl = elementById("save-all-failed");
		const failureEl = elementById("save-all-failure");
		const hintEl = elementById("save-all-hint");
		const readlistButton = elementById("save-all-view-readlist");

		progressEl.hidden = false;
		titleEl.textContent = "Saving tabs…";
		summaryEl.textContent = "";
		tooBigEl.textContent = "";
		tooBigEl.hidden = true;
		failedListEl.replaceChildren();
		failedListEl.hidden = true;
		failureEl.hidden = true;
		hintEl.hidden = false;
		readlistButton.hidden = true;

		const result = await send<GuardedResult<BulkSaveResult>>({
			type: "save-all-tabs",
			tabs: saveable,
			tabCount: tabs.length,
		});

		if (isNotLoggedIn(result)) {
			showLoginPrompt();
			return;
		}

		hintEl.hidden = true;

		if (!result.ok) {
			progressEl.hidden = true;
			elementById("save-all-failure-title").textContent = BULK_SAVE_FAILED_TITLE;
			failureEl.hidden = false;
			readlistButton.hidden = false;
			return;
		}

		const { title, summary, tooBig } = summarizeBulkSave({
			result: result.value,
			tabCount: tabs.length,
			saveableCount: saveable.length,
		});
		titleEl.textContent = title;
		paintSaveAllSummary(summaryEl, summary);
		tooBigEl.textContent = tooBig ?? "";
		tooBigEl.hidden = tooBig === null;
		renderSaveAllDetailLines(
			failedListEl,
			buildSaveAllDetailLines({ ...result.value, clientSkipReasons: skipReasons }),
		);

		if (result.value.unauthorized) {
			performance.mark(SAVE_ALL_RENDERED_MARK);
			return;
		}

		readlistButton.hidden = false;
		performance.mark(SAVE_ALL_RENDERED_MARK);
	}

	async function revealSaveAllTabs() {
		const stored = await browser.storage.local.get(
			ADVERTISED_CAPABILITIES_STORAGE_KEY,
		);
		const advertised = advertisesBulkSave(
			parseStoredCapabilities(stored[ADVERTISED_CAPABILITIES_STORAGE_KEY]),
		);
		/** Unfiltered on purpose: the save reports an outcome for every tab counted
		 * here, skips included, so a filtered count would under-report its own scope. */
		const tabs = await browser.tabs.query({ currentWindow: true });
		const count = document.querySelector(".list-view__save-all-count");
		if (count) count.textContent = saveAllTabsLabel(tabs.length);
		const button = document.getElementById("save-all-tabs-button");
		if (button) button.hidden = !advertised;
		const hint = document.getElementById("save-all-shortcut-hint");
		if (hint) hint.hidden = !advertised;
	}

	async function bootstrap() {
		const stored = await browser.storage.session.get("pendingBulkSave");
		if (stored.pendingBulkSave) {
			await browser.storage.session.remove("pendingBulkSave").catch(() => {});
			await saveAllTabsFlow();
			return;
		}
		await saveAndShowList();
	}

	elementById("save-all-view-readlist").addEventListener("click", async () => {
		await showListView().catch(showListLoadFailure);
	});

	elementById("login-button").addEventListener("click", async () => {
		const loginError = elementById("login-error");
		loginError.hidden = true;

		try {
			const result = await send<{
				ok: boolean;
				reason?: string;
				error?: { message?: string };
			}>({ type: "login" });
			if (!result.ok) {
				logger.error("Sign-in failed:", result.reason, result.error);
				loginError.hidden = false;
				return;
			}
		} catch (err) {
			logger.error("Sign-in failed:", err);
			loginError.hidden = false;
			return;
		}

		showSaving();
		await saveAndShowList().catch(showListLoadFailure);
	});

	elementById("save-all-tabs-button").addEventListener("click", async () => {
		await saveAllTabsFlow();
	});

	elementById("logout-button").addEventListener("click", performLogout);

	elementById("filter-input").addEventListener("input", () => {
		renderLinks(filterItems());
	});

	function paintShortcutHint(hint: {
		id: string;
		lead: string;
		segments: string[];
		trail: string;
	}): void {
		const element = document.getElementById(hint.id);
		if (!element) return;
		element.replaceChildren(document.createTextNode(hint.lead));
		hint.segments.forEach((segment, index) => {
			if (index > 0) element.appendChild(document.createTextNode("+"));
			const key = document.createElement("kbd");
			key.className = "shortcut-hint__key";
			key.textContent = segment;
			element.appendChild(key);
		});
		element.appendChild(document.createTextNode(hint.trail));
	}

	/** Read straight from the browser rather than the binding the background cached:
	 * the popup can open before the worker has woken to refresh that cache, and a
	 * hint naming a key the user no longer has is worse than no hint. */
	async function renderShortcutHints() {
		const bindings = commandBindingsFromGetAll(await browser.commands.getAll());
		const mac = isMacPlatform(navigator);

		paintShortcutHint({
			id: "save-shortcut-hint",
			lead: "Save any page with ",
			segments: shortcutHintSegments({ stored: bindings.save, fallback: DEFAULT_SAVE_SHORTCUT, mac }),
			trail: ".",
		});
		paintShortcutHint({
			id: "save-all-shortcut-hint",
			lead: "Save all tabs with ",
			segments: shortcutHintSegments({ stored: bindings.saveAll, fallback: DEFAULT_SAVE_ALL_SHORTCUT, mac }),
			trail: ".",
		});

		suppressed.save = resolveShortcut({ stored: bindings.save, fallback: DEFAULT_SAVE_SHORTCUT });
		suppressed.saveAll = resolveShortcut({ stored: bindings.saveAll, fallback: DEFAULT_SAVE_ALL_SHORTCUT });
	}

	renderShortcutHints().catch((error) =>
		logger.error("Failed to read command shortcuts:", error),
	);

	revealSaveAllTabs().catch((error) =>
		logger.error("Failed to read advertised capabilities:", error),
	);

	bootstrap().catch(showListLoadFailure);
}
