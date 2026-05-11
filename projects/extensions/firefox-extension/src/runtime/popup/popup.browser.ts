/* c8 ignore start -- popup entry point, all DOM + browser API glue, tested via Selenium E2E */
import type {
	ReadingListItem,
	PopupMessage,
	GuardedResult,
	SaveUrlResult,
	RemoveUrlResult,
} from "browser-extension-core";
import { filterByUrl, paginateItems, avatarColor, relativeTime, isAppUrl } from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";

declare const __APP_DOMAINS__: string[];

const logger = HutchLogger.from(consoleLogger);

function showView(id: string) {
	for (const view of document.querySelectorAll(".view")) {
		(view as HTMLElement).hidden = true;
	}
	const target = document.getElementById(id);
	if (target) target.hidden = false;
}

/**
 * 1. Defer one frame so the browser has committed the initial 0% width
 *    before we set the target. Without this the transition collapses into a
 *    single computed-style read and the bar jumps to 90% with no animation.
 */
function startSavingProgress() {
	const fill = document.querySelector(".saving-view__progress-fill");
	if (!fill) return;
	requestAnimationFrame(() => {
		fill.classList.add("saving-view__progress-fill--starting");
	});
}

function finishSavingProgress(): Promise<void> {
	return new Promise((resolve) => {
		const fill = document.querySelector(".saving-view__progress-fill");
		if (!fill) {
			resolve();
			return;
		}
		fill.classList.remove("saving-view__progress-fill--starting");
		fill.classList.add("saving-view__progress-fill--complete");
		setTimeout(resolve, 350); // 200ms snap to 100% + 150ms hold
	});
}

function send(message: PopupMessage): Promise<unknown> {
	return browser.runtime.sendMessage(message);
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

		const itemLink = document.createElement("a");
		itemLink.className = "list-view__item";
		itemLink.href = item.readUrl ?? item.url;
		itemLink.target = "_blank";
		itemLink.rel = "noopener noreferrer";

		const hostname = new URL(item.url).hostname;

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

		const deleteButton = document.createElement("button");
		deleteButton.className = "list-view__delete";
		deleteButton.textContent = "\u00D7";
		deleteButton.title = "Remove from list";
		deleteButton.setAttribute("aria-label", "Remove from list");
		deleteButton.addEventListener("click", async () => {
			const overlay = document.getElementById("spinner-overlay");
			if (overlay) overlay.hidden = false;
			try {
				const result = (await send({
					type: "remove-item",
					id: item.id,
				})) as GuardedResult<RemoveUrlResult>;

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

		row.appendChild(itemLink);
		row.appendChild(deleteButton);
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
	const result = (await send({
		type: "get-all-items",
	})) as GuardedResult<ReadingListItem[]>;

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

async function showListView() {
	showView("list-view");
	setListWarning(null);
	await loadAllItems();
}

async function getActiveTab(): Promise<{ url: string; title: string } | null> {
	const params = new URLSearchParams(window.location.search);
	const paramUrl = params.get("url");
	if (paramUrl) return { url: paramUrl, title: params.get("title") ?? paramUrl };

	const tabs = await browser.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];
	if (!tab?.url) return null;
	return { url: tab.url, title: tab.title ?? tab.url };
}

async function saveAndShowList() {
	const activeTab = await getActiveTab();
	if (!activeTab) throw new Error("No active tab or URL parameters");

	if (isAppUrl({ tabUrl: activeTab.url, appDomains: __APP_DOMAINS__ })) {
		await showListView();
		return;
	}

	const checkResult = (await send({
		type: "check-url",
		url: activeTab.url,
	})) as GuardedResult<ReadingListItem | null>;

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

	const savingTitle = document.querySelector(".saving-view__title");
	if (savingTitle) savingTitle.textContent = "Saving\u2026";
	const progressBar = document.querySelector(".saving-view__progress");
	if (progressBar) progressBar.setAttribute("aria-label", "Saving article");

	const saveResult = (await send({
		type: "save-current-tab",
		url: activeTab.url,
		title: activeTab.title,
	})) as GuardedResult<SaveUrlResult>;

	if (isNotLoggedIn(saveResult)) {
		await performLogout();
		return;
	}

	if (saveResult.ok && saveResult.value.ok) {
		await finishSavingProgress();
		showView("saved-view");
		return;
	}

	if (saveResult.ok && !saveResult.value.ok && saveResult.value.reason === "not-saveable") {
		allItems = saveResult.value.items;
		showView("list-view");
		setListWarning(saveResult.value.warning?.message ?? null);
		renderLinks(filterItems());
	}
}

document.getElementById("login-button")?.addEventListener("click", async () => {
	const loginError = document.getElementById("login-error");
	if (loginError) loginError.hidden = true;

	try {
		const result = (await send({ type: "login" })) as {
			ok: boolean;
			reason?: string;
			error?: { message?: string };
		};
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
	startSavingProgress();
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
	// navigator.platform is deprecated but navigator.userAgentData is not
	// supported in Firefox, so this is the best available approach
	const isMac = navigator.platform.startsWith("Mac");
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

startSavingProgress();
saveAndShowList().catch((error) => {
	logger.error("Failed to initialize popup:", error);
	showView("list-view");
	const listError = document.getElementById("list-error");
	if (listError) listError.hidden = false;
});
/* c8 ignore stop */
