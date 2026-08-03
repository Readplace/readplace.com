/* c8 ignore start -- popup entry point, all DOM + browser API glue, tested via Selenium E2E */
import browser from "webextension-polyfill";
import type {
	CollectionPage,
	LoadPageResult,
	PageDescriptor,
	PaginationView,
	ReadingListItem,
	PopupMessage,
	GuardedResult,
	SaveUrlResult,
	InvokeActionResult,
	BulkSaveResult,
	Message,
	ActionVariant,
} from "browser-extension-core";
import { filterByUrl, buildPaginationView, avatarColor, relativeTime, isAppUrl, itemDisplay, selectSaveableTabs, summarizeBulkSave, installShortcuts, isCmdD, buildMessageView, buildSavedView, actionLabel, actionVariant, actionIcon, linkLabel, linkPresentation, SAVE_RENDERED_MARK, SAVE_ALL_RENDERED_MARK } from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";

/** The client's own presentation map: an action variant -> the popup's CSS
 * class. The server never sends a class; the variant comes from mapping the
 * action `name` client-side (actionVariant), and an unknown name falls back to
 * the default. */
const ACTION_CLASS_BY_VARIANT: Record<ActionVariant, string> = {
	danger: "list-view__delete",
	default: "list-view__action",
};

declare const __APP_DOMAINS__: string[];

declare global {
	interface Navigator {
		userAgentData?: { platform: string };
	}
}

const logger = HutchLogger.from(consoleLogger);

// Suppress Cmd+D inside the popup canvas — content scripts don't run on
// chrome-extension:// pages, so the page-level intercept can't reach here.
installShortcuts(document, [{ matches: isCmdD }]);

function showView(id: string) {
	for (const view of document.querySelectorAll(".view")) {
		(view as HTMLElement).hidden = true;
	}
	const target = document.getElementById(id);
	if (target) target.hidden = false;
}

/** Isolated boundary wrapper: the single contained assertion for the untyped
 * webextension-polyfill response, so call sites stay free of `as`. */
function send<T>(message: PopupMessage): Promise<T> {
	return browser.runtime.sendMessage(message) as Promise<T>;
}

async function performLogout() {
	await send({ type: "logout" });
	showView("login-view");
}

function isNotLoggedIn(result: { ok: boolean; reason?: string }): boolean {
	return !result.ok && result.reason === "not-logged-in";
}

let currentItems: ReadingListItem[] = [];
let pageList: PageDescriptor[] = [];
let loadingPage = false;

function stepButton(step: {
	glyph: string;
	label: string;
	target: number | undefined;
}): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "pagination__button";
	button.textContent = step.glyph;
	button.title = step.label;
	button.setAttribute("aria-label", step.label);
	button.disabled = step.target === undefined || loadingPage;
	button.addEventListener("click", () => {
		if (step.target !== undefined) void loadPage(step.target);
	});
	return button;
}

function renderPagination(view: PaginationView) {
	const pagination = document.getElementById("pagination");
	if (!pagination) throw new Error("pagination element not found");

	pagination.innerHTML = "";
	pagination.hidden = view.hidden;
	if (view.hidden) return;

	pagination.appendChild(
		stepButton({ glyph: "\u2039", label: "Previous page", target: view.previous }),
	);

	for (const page of view.pages) {
		if ("gap" in page) {
			const gap = document.createElement("span");
			gap.className = "pagination__gap";
			gap.textContent = "\u2026";
			pagination.appendChild(gap);
			continue;
		}
		const pageButton = document.createElement("button");
		pageButton.className = "pagination__page";
		pageButton.textContent = page.label;
		if (page.active) {
			pageButton.classList.add("pagination__page--active");
			pageButton.setAttribute("aria-current", "page");
		}
		pageButton.disabled = page.active || loadingPage;
		pageButton.addEventListener("click", () => {
			void loadPage(page.index);
		});
		pagination.appendChild(pageButton);
	}

	pagination.appendChild(
		stepButton({ glyph: "\u203A", label: "Next page", target: view.next }),
	);
}

function renderLinks(items: ReadingListItem[]) {
	const linkList = document.getElementById("link-list");
	const emptyList = document.getElementById("empty-list");
	const noMatches = document.getElementById("no-matches");

	if (!linkList) throw new Error("link-list element not found");
	if (!emptyList) throw new Error("empty-list element not found");
	if (!noMatches) throw new Error("no-matches element not found");

	linkList.innerHTML = "";
	emptyList.hidden = true;
	noMatches.hidden = true;
	setListError(null);

	if (currentItems.length === 0) {
		emptyList.hidden = false;
		renderPagination(buildPaginationView(visiblePageList()));
		return;
	}

	if (items.length === 0) {
		noMatches.hidden = false;
		renderPagination(buildPaginationView(visiblePageList()));
		return;
	}

	for (const item of items) {
		const row = document.createElement("div");
		row.className = "list-view__row";

		const { hostname } = itemDisplay(item);

		const itemLink = document.createElement("a");
		itemLink.className = "list-view__item";
		itemLink.target = "_blank";
		itemLink.rel = "noopener noreferrer";

		const avatar = document.createElement("div");
		avatar.className = "list-view__avatar";
		avatar.textContent = hostname.charAt(0);
		avatar.style.backgroundColor = avatarColor(hostname);

		const textContainer = document.createElement("div");
		textContainer.className = "list-view__text";

		const title = document.createElement("span");
		title.className = "list-view__item-title";
		title.textContent = item.title;

		const domain = document.createElement("span");
		domain.className = "list-view__domain";
		domain.textContent = hostname;

		textContainer.appendChild(title);
		textContainer.appendChild(domain);

		const time = document.createElement("span");
		time.className = "list-view__time";
		time.textContent = relativeTime(new Date(item.savedAt));

		itemLink.appendChild(avatar);
		itemLink.appendChild(textContainer);
		itemLink.appendChild(time);

		row.appendChild(itemLink);

		// One control per advertised SEMANTIC link \u2014 loop the item's link
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
			const label = linkLabel(link);
			const control = document.createElement("a");
			control.className = "list-view__action";
			control.href = link.href;
			control.target = "_blank";
			control.rel = "noopener noreferrer";
			control.textContent = label;
			control.title = label;
			control.setAttribute("aria-label", label);
			row.appendChild(control);
		}

		// One control per advertised affordance \u2014 loop the item's action
		// descriptors and render a button each. No per-capability boolean and no
		// hardcoded "does the client know action X" check, so a newly-advertised
		// server action renders here with no popup change.
		for (const action of item.actions) {
			const button = document.createElement("button");
			button.className = ACTION_CLASS_BY_VARIANT[actionVariant(action.name)];
			const label = actionLabel(action);
			const icon = actionIcon(action.name);
			if (icon === undefined) {
				button.textContent = label;
			} else {
				button.innerHTML = icon;
			}
			button.title = label;
			button.setAttribute("aria-label", label);
			button.addEventListener("click", async () => {
				const overlay = document.getElementById("spinner-overlay");
				if (overlay) overlay.hidden = false;
				try {
					const result = await send<GuardedResult<InvokeActionResult>>({
						type: "invoke-action",
						id: item.id,
						name: action.name,
					});

					if (isNotLoggedIn(result)) {
						await performLogout();
						return;
					}

					if (result.ok && result.value.ok) {
						/** The mutation answered with the list as it now stands, page list
						 * and all, so the reader lands wherever that answer says — there is
						 * no page counter here to reconcile against it. */
						currentItems = result.value.items;
						pageList = result.value.pages;
						renderLinks(filterItems());
					} else if (result.ok) {
						/** not-found: the item was removed elsewhere or the server no
						 * longer advertises this action. Reload so the stale phantom row
						 * drops instead of lingering until the popup is reopened. */
						await loadAllItems();
					} else {
						/** Generic failure (server 5xx / transient network) — the
						 * not-logged-in case already returned above. The action didn't
						 * apply and the row is unchanged, so surface an error instead of
						 * hiding the spinner with no feedback at all. */
						setListError("Couldn't complete that action. Try again?");
					}
				} finally {
					if (overlay) overlay.hidden = true;
				}
			});
			row.appendChild(button);
		}

		linkList.appendChild(row);
	}

	renderPagination(buildPaginationView(visiblePageList()));
}

function filterQuery(): string {
	const filterInput = document.getElementById("filter-input");
	if (!filterInput) throw new Error("filter-input element not found");
	return (filterInput as HTMLInputElement).value;
}

function filterItems(): ReadingListItem[] {
	return filterByUrl(currentItems, filterQuery());
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
		await performLogout();
		return "logged-out";
	}

	if (!result.ok) {
		setListError("Failed to load links");
		return "failed";
	}

	currentItems = result.value.items;
	pageList = result.value.pages;
	renderLinks(filterItems());
	return "loaded";
}

async function loadPage(index: number): Promise<void> {
	if (loadingPage) return;
	loadingPage = true;
	let result: GuardedResult<LoadPageResult>;
	try {
		result = await send<GuardedResult<LoadPageResult>>({
			type: "load-page",
			index,
		});
	} finally {
		loadingPage = false;
	}

	if (isNotLoggedIn(result)) {
		await performLogout();
		return;
	}

	if (!result.ok) {
		setListError("Failed to load links");
		return;
	}

	if ("pageList" in result.value) {
		await loadAllItems();
		return;
	}

	currentItems = result.value.items;
	pageList = result.value.pages;
	renderLinks(filterItems());
}

function setListWarning(message: string | null): void {
	const warningEl = document.getElementById("list-warning");
	if (!warningEl) return;
	if (message) {
		warningEl.textContent = message;
		warningEl.hidden = false;
	} else {
		warningEl.textContent = "";
		warningEl.hidden = true;
	}
}

// Each caller passes its own message so the surface never shows a stale one — a
// failed action and a failed load read differently. Error counterpart of
// setListWarning.
function setListError(message: string | null): void {
	const errorEl = document.getElementById("list-error");
	if (!errorEl) throw new Error("list-error element not found");
	if (message) {
		errorEl.textContent = message;
		errorEl.hidden = false;
	} else {
		errorEl.textContent = "";
		errorEl.hidden = true;
	}
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
		const el = document.createElement("div");
		el.className = item.className;
		el.innerHTML = item.html;
		container.appendChild(el);
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
		const label = linkLabel(link);
		const control =
			presentation === "list-view"
				? document.createElement("button")
				: document.createElement("a");
		control.className = "saved-view__action";
		control.textContent = label;
		control.setAttribute("aria-label", label);
		if (control instanceof HTMLAnchorElement) {
			control.href = link.href;
			control.target = "_blank";
			control.rel = "noopener noreferrer";
		} else {
			control.addEventListener("click", () => {
				void showListView();
			});
		}
		affordances.appendChild(control);
	}
}

async function showListView() {
	setListWarning(null);
	renderMessages([]);
	if ((await loadAllItems()) === "logged-out") return;
	showView("list-view");
}

async function getActiveTab(): Promise<{ url: string; title: string; tabId?: number } | null> {
	const stored = await browser.storage.session.get("pendingTarget");
	const pending = stored.pendingTarget;
	if (pending && typeof pending.url === "string") {
		await browser.storage.session.remove("pendingTarget").catch(() => {});
		const title =
			typeof pending.title === "string" ? pending.title : pending.url;
		/** The tab travels with the target when the target is that tab's own page,
		 * so a save started from outside the toolbar can still mark it from the
		 * save's own outcome instead of asking the server what is on screen. */
		const target: { url: string; title: string; tabId?: number } = {
			url: pending.url,
			title,
		};
		if (typeof pending.tabId === "number") target.tabId = pending.tabId;
		return target;
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

	if (isAppUrl({ tabUrl: activeTab.url, appDomains: __APP_DOMAINS__ })) {
		await showListView();
		return;
	}

	showView("saving-view");

	const saveResult = await send<GuardedResult<SaveUrlResult>>({
		type: "save-current-tab",
		url: activeTab.url,
		title: activeTab.title,
		tabId: activeTab.tabId,
	});

	if (isNotLoggedIn(saveResult)) {
		await performLogout();
		return;
	}

	if (saveResult.ok && saveResult.value.ok) {
		renderSavedView(saveResult.value);
		showView("saved-view");
		performance.mark(SAVE_RENDERED_MARK);
		return;
	}

	if (saveResult.ok && !saveResult.value.ok && "reason" in saveResult.value && saveResult.value.reason === "not-saveable") {
		currentItems = saveResult.value.items;
		pageList = saveResult.value.pages;
		showView("list-view");
		renderMessages([]);
		setListWarning(saveResult.value.warning?.message ?? null);
		renderLinks(filterItems());
	}

	if (saveResult.ok && !saveResult.value.ok && "messages" in saveResult.value) {
		/** Interceptor: the server refused the save with messages to show.
		 * Render them and drop the user into their list — existing items stay
		 * manageable, but the new link was not saved. The two server-message
		 * channels are mutually exclusive, so clear the warning one. */
		showView("list-view");
		setListWarning(null);
		renderMessages(saveResult.value.messages);
		await loadAllItems();
	}
}

async function saveAllTabsFlow() {
	showView("save-all-view");
	const tabs = await browser.tabs.query({ currentWindow: true });
	const saveable = selectSaveableTabs(tabs, __APP_DOMAINS__);

	const titleEl = document.querySelector("[data-test-save-all-title]");
	const summaryEl = document.querySelector("[data-test-save-all-summary]");
	const tooBigEl = document.querySelector<HTMLElement>("[data-test-save-all-too-big]");

	const result = (await send({
		type: "save-all-tabs",
		tabs: saveable,
	})) as GuardedResult<BulkSaveResult>;

	if (isNotLoggedIn(result)) {
		await performLogout();
		return;
	}

	if (!result.ok) {
		if (titleEl) titleEl.textContent = "Couldn't save tabs";
		if (summaryEl) summaryEl.textContent = "Something went wrong. Please try again.";
		return;
	}

	const { title, summary, tooBig } = summarizeBulkSave({
		result: result.value,
		tabCount: tabs.length,
		saveableCount: saveable.length,
	});
	if (titleEl) titleEl.textContent = title;
	if (summaryEl) summaryEl.textContent = summary;
	if (tooBigEl) {
		tooBigEl.textContent = tooBig ?? "";
		tooBigEl.hidden = tooBig === null;
	}

	const queueButton = document.getElementById("save-all-view-queue");
	if (queueButton) queueButton.hidden = false;
	performance.mark(SAVE_ALL_RENDERED_MARK);
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

document
	.getElementById("save-all-view-queue")
	?.addEventListener("click", async () => {
		await showListView();
	});

document.getElementById("login-button")?.addEventListener("click", async () => {
	const loginError = document.getElementById("login-error");
	if (loginError) loginError.hidden = true;

	try {
		const result = await send<{
			ok: boolean;
			reason?: string;
			error?: { message?: string };
		}>({ type: "login" });
		if (!result.ok) {
			if (loginError) {
				loginError.textContent = `Login failed: ${result.reason ?? "unknown"} — ${result.error?.message ?? ""}`;
				loginError.hidden = false;
			}
			return;
		}
	} catch (err) {
		if (loginError) {
			loginError.textContent = `Login error: ${err instanceof Error ? err.message : String(err)}`;
			loginError.hidden = false;
		}
		return;
	}

	showView("saving-view");
	await saveAndShowList();
});

document
	.getElementById("logout-button")
	?.addEventListener("click", performLogout);

document.getElementById("filter-input")?.addEventListener("input", () => {
	renderLinks(filterItems());
});

const shortcutHint = document.querySelector(".shortcut-hint");
if (shortcutHint) {
	const isMac = navigator.userAgentData
		? navigator.userAgentData.platform === "macOS"
		: navigator.platform.startsWith("Mac");
	if (isMac) {
		shortcutHint.textContent = "";
		const prefix = document.createTextNode("Tip: Use ");
		const cmdKey = document.createElement("kbd");
		cmdKey.textContent = "\u2318";
		const plus = document.createTextNode("+");
		const dKey = document.createElement("kbd");
		dKey.textContent = "D";
		const suffix = document.createTextNode(" to save from any page");
		shortcutHint.append(prefix, cmdKey, plus, dKey, suffix);
	}
}

bootstrap().catch((error) => {
	logger.error("Failed to initialize popup:", error);
	showView("list-view");
	setListError("Failed to load links");
});
/* c8 ignore stop */
