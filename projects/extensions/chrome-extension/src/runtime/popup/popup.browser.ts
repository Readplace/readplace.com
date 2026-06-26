/* c8 ignore start -- popup entry point, all DOM + browser API glue, tested via Selenium E2E */
import browser from "webextension-polyfill";
import type {
	ReadingListItem,
	PopupMessage,
	SavePhase,
	GuardedResult,
	SaveUrlResult,
	InvokeActionResult,
	Message,
	ActionVariant,
} from "browser-extension-core";
import { filterByUrl, paginateItems, avatarColor, relativeTime, isAppUrl, itemDisplay, installShortcuts, isCmdD, initSaveProgress, initSaveProgressSequencer, buildMessageView, actionLabel, actionVariant, actionIcon, linkLabel, linkPresentation } from "browser-extension-core";
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

const saveProgress = initSaveProgress();

const sequencer = initSaveProgressSequencer({
	minDwellMs: 450,
	scheduler: {
		setTimer: (callback, delayMs) => {
			setTimeout(callback, delayMs);
		},
		now: () => performance.now(),
	},
	apply: (phase) => {
		const fill = document.querySelector<HTMLElement>(".saving-view__progress-fill");
		if (fill) fill.style.width = saveProgress.widthFor(phase);
		const title = document.querySelector(".saving-view__title");
		if (title) title.textContent = saveProgress.labelFor(phase);
	},
});

function isSavePhase(value: unknown): value is SavePhase {
	return value === "capturing" || value === "uploading";
}

function isSaveProgressMessage(
	value: unknown,
): value is { type: "save-progress"; phase: SavePhase } {
	if (typeof value !== "object" || value === null) return false;
	if (!("type" in value) || value.type !== "save-progress") return false;
	return "phase" in value && isSavePhase(value.phase);
}

browser.runtime.onMessage.addListener((raw) => {
	if (!isSaveProgressMessage(raw)) return undefined;
	sequencer.enqueue(raw.phase);
	return undefined;
});

async function finishSavingProgress(): Promise<void> {
	await sequencer.finish();
	return new Promise((resolve) => {
		const fill = document.querySelector<HTMLElement>(".saving-view__progress-fill");
		if (!fill) {
			resolve();
			return;
		}
		// Inline width beats the prior milestone's inline width; --complete swaps
		// the long milestone ease for the 0.2s snap to the terminal 100%.
		fill.style.width = "100%";
		fill.classList.add("saving-view__progress-fill--complete");
		setTimeout(resolve, 350); // 200ms snap to 100% + 150ms hold
	});
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

let allItems: ReadingListItem[] = [];
let currentPage = 1;

function renderPagination(totalPages: number, visiblePages: number[]) {
	const pagination = document.getElementById("pagination");
	if (!pagination) throw new Error("pagination element not found");

	pagination.innerHTML = "";

	if (totalPages <= 1) {
		pagination.hidden = true;
		return;
	}

	pagination.hidden = false;

	const prevButton = document.createElement("button");
	prevButton.className = "pagination__button";
	prevButton.textContent = "\u2039";
	prevButton.title = "Previous page";
	prevButton.setAttribute("aria-label", "Previous page");
	prevButton.disabled = currentPage <= 1;
	prevButton.addEventListener("click", () => {
		currentPage--;
		renderLinks(filterItems());
	});
	pagination.appendChild(prevButton);

	for (const page of visiblePages) {
		const pageButton = document.createElement("button");
		pageButton.className = "pagination__page";
		if (page === currentPage) {
			pageButton.classList.add("pagination__page--active");
		}
		pageButton.textContent = String(page);
		pageButton.addEventListener("click", () => {
			currentPage = page;
			renderLinks(filterItems());
		});
		pagination.appendChild(pageButton);
	}

	const nextButton = document.createElement("button");
	nextButton.className = "pagination__button";
	nextButton.textContent = "\u203A";
	nextButton.title = "Next page";
	nextButton.setAttribute("aria-label", "Next page");
	nextButton.disabled = currentPage >= totalPages;
	nextButton.addEventListener("click", () => {
		currentPage++;
		renderLinks(filterItems());
	});
	pagination.appendChild(nextButton);
}

function renderLinks(items: ReadingListItem[]) {
	const linkList = document.getElementById("link-list");
	const emptyList = document.getElementById("empty-list");
	const noMatches = document.getElementById("no-matches");
	const listError = document.getElementById("list-error");

	if (!linkList) throw new Error("link-list element not found");
	if (!emptyList) throw new Error("empty-list element not found");
	if (!noMatches) throw new Error("no-matches element not found");
	if (!listError) throw new Error("list-error element not found");

	linkList.innerHTML = "";
	emptyList.hidden = true;
	noMatches.hidden = true;
	listError.hidden = true;

	if (allItems.length === 0) {
		emptyList.hidden = false;
		renderPagination(1, [1]);
		return;
	}

	if (items.length === 0) {
		noMatches.hidden = false;
		renderPagination(1, [1]);
		return;
	}

	const sorted = [...items].sort(
		(a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
	);

	const paginated = paginateItems(sorted, currentPage);
	currentPage = paginated.currentPage;

	for (const item of paginated.items) {
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
			button.textContent = actionIcon(action.name) ?? label;
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
						allItems = result.value.items;
						renderLinks(filterItems());
					}
				} finally {
					if (overlay) overlay.hidden = true;
				}
			});
			row.appendChild(button);
		}

		linkList.appendChild(row);
	}

	renderPagination(paginated.totalPages, paginated.visiblePages);
}

function filterItems(): ReadingListItem[] {
	const filterInput = document.getElementById("filter-input");
	if (!filterInput) throw new Error("filter-input element not found");
	return filterByUrl(allItems, (filterInput as HTMLInputElement).value);
}

async function loadAllItems() {
	const result = await send<GuardedResult<ReadingListItem[]>>({
		type: "get-all-items",
	});

	if (isNotLoggedIn(result)) {
		await performLogout();
		return;
	}

	if (!result.ok) {
		const listError = document.getElementById("list-error");
		if (!listError) throw new Error("list-error element not found");
		listError.hidden = false;
		return;
	}

	allItems = result.value;
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

// Server-driven messages: the extension knows only how to render them, never
// what they mean. `buildMessageView` (tested in browser-extension-core) makes
// every rendering decision; this glue only paints it. `item.html` is the
// server-authored text/html body, injected as HTML — trusted by contract (see
// the Message type / the hypermedia-api-design skill).
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

async function showListView() {
	showView("list-view");
	setListWarning(null);
	renderMessages([]);
	await loadAllItems();
}

async function getActiveTab(): Promise<{ url: string; title: string; tabId?: number } | null> {
	const stored = await browser.storage.session.get("pendingTarget");
	const pending = stored.pendingTarget;
	if (pending && typeof pending.url === "string") {
		await browser.storage.session.remove("pendingTarget").catch(() => {});
		const title =
			typeof pending.title === "string" ? pending.title : pending.url;
		return { url: pending.url, title };
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

	const checkResult = await send<GuardedResult<ReadingListItem | null>>({
		type: "check-url",
		url: activeTab.url,
	});

	if (isNotLoggedIn(checkResult)) {
		await performLogout();
		return;
	}

	if (!checkResult.ok) {
		return;
	}

	if (checkResult.value) {
		await showListView();
		return;
	}

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
		await finishSavingProgress();
		showView("saved-view");
		return;
	}

	if (saveResult.ok && !saveResult.value.ok && "reason" in saveResult.value && saveResult.value.reason === "not-saveable") {
		allItems = saveResult.value.items;
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
	.getElementById("view-queue-button")
	?.addEventListener("click", async () => {
		await showListView();
	});

document
	.getElementById("logout-button")
	?.addEventListener("click", performLogout);

document.getElementById("filter-input")?.addEventListener("input", () => {
	currentPage = 1;
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

saveAndShowList().catch((error) => {
	logger.error("Failed to initialize popup:", error);
	showView("list-view");
	const listError = document.getElementById("list-error");
	if (listError) listError.hidden = false;
});
/* c8 ignore stop */
