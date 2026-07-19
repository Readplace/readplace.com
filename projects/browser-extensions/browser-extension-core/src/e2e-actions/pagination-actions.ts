import assert from "node:assert/strict";
import { By } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, ELEMENT_IDS, type FlowAction } from "../e2e";
import { waitForUi } from "./wait-budget";

export interface PaginationProgress {
	paginationLinksAdded: boolean;
	verifiedPage1: boolean;
	navigatedToPage2: boolean;
	verifiedPage2: boolean;
	navigatedBackToPage1: boolean;
	verifiedBackOnPage1: boolean;
}

/** 12 items total = 1 save-link + 1 save-extra-link + PAGINATION_LINK_COUNT.
 * 12 exceeds the 10/page threshold so pagination triggers, page 1 = 10, page 2 = 2.
 * Only 10 of those URLs match the "pagination" filter so the filter-with-match
 * action sees ≤10 results and pagination hides on the filtered view. */
const PAGINATION_LINK_COUNT = 10;
const ACTIVE_PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} .pagination__page--active`;
const NEXT_PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} button[aria-label="Next page"]`;
const PREV_PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} button[aria-label="Previous page"]`;

async function isListViewVisible(driver: WebDriver): Promise<boolean> {
	try {
		const listView = await driver.findElement(By.id("list-view"));
		const hidden = await listView.getAttribute("hidden");
		assert.equal(hidden, null, "list-view should be visible");
		return true;
	} catch {
		return false;
	}
}

async function waitForSavedOrListView(driver: WebDriver): Promise<void> {
	await waitForUi(driver, async () => {
		try {
			const savedView = await driver.findElement(By.id("saved-view"));
			const savedHidden = await savedView.getAttribute("hidden");
			if (savedHidden === null) return true;
			const listView = await driver.findElement(By.id("list-view"));
			const listHidden = await listView.getAttribute("hidden");
			return listHidden === null;
		} catch {
			return false;
		}
	});
}

async function waitForListView(driver: WebDriver): Promise<void> {
	await waitForUi(driver, async () => {
		try {
			const listView = await driver.findElement(By.id("list-view"));
			const hidden = await listView.getAttribute("hidden");
			return hidden === null;
		} catch {
			return false;
		}
	});
}

export function createPaginationActions(config: {
	popupUrl: string;
	saveLinkProgress: { linkSaved: boolean; listVerified: boolean; extraLinkSaved: boolean };
	progress: PaginationProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();
	let paginationLinksAdded = 0;

	for (let i = 0; i < PAGINATION_LINK_COUNT; i++) {
		actions.set(`save-pagination-link-${i + 1}`, {
			async isAvailable(driver: WebDriver): Promise<boolean> {
				if (!config.saveLinkProgress.extraLinkSaved) return false;
				if (paginationLinksAdded !== i) return false;
				return isListViewVisible(driver);
			},
			async execute(driver: WebDriver): Promise<void> {
				const url = `https://example.com/pagination-test-${i + 1}`;
				const title = `Pagination Article ${i + 1}`;
				const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
				await driver.get(saveUrl);
				await waitForSavedOrListView(driver);
				await driver.get(config.popupUrl);
				await waitForListView(driver);
				paginationLinksAdded = i + 1;
				if (paginationLinksAdded === PAGINATION_LINK_COUNT) {
					config.progress.paginationLinksAdded = true;
				}
			},
		});
	}

	actions.set("verify-page1-pagination", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.paginationLinksAdded) return false;
			if (config.progress.verifiedPage1) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const pagination = await driver.findElement(By.id(ELEMENT_IDS.pagination));
			const paginationHidden = await pagination.getAttribute("hidden");
			assert.equal(paginationHidden, null, "Pagination should be visible with 12 items");

			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			assert.equal(items.length, 10, "Page 1 should show 10 items");

			const activePage = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
			const activeText = await activePage.getText();
			assert.equal(activeText, "1", "Page 1 should be active");

			config.progress.verifiedPage1 = true;
		},
	});

	actions.set("navigate-to-page2", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.verifiedPage1) return false;
			if (config.progress.navigatedToPage2) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const nextButton = await driver.findElement(By.css(NEXT_PAGE_SELECTOR));
			await nextButton.click();
			await waitForUi(driver, async () => {
				try {
					const active = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
					const text = await active.getText();
					return text === "2";
				} catch {
					return false;
				}
			});
			config.progress.navigatedToPage2 = true;
		},
	});

	actions.set("verify-page2", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.navigatedToPage2) return false;
			if (config.progress.verifiedPage2) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			assert.equal(items.length, 2, "Page 2 should show 2 items (12 total, 10 per page)");

			const activePage = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
			const activeText = await activePage.getText();
			assert.equal(activeText, "2", "Page 2 should be active");

			config.progress.verifiedPage2 = true;
		},
	});

	actions.set("navigate-back-to-page1", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.verifiedPage2) return false;
			if (config.progress.navigatedBackToPage1) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const prevButton = await driver.findElement(By.css(PREV_PAGE_SELECTOR));
			await prevButton.click();
			await waitForUi(driver, async () => {
				try {
					const active = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
					const text = await active.getText();
					return text === "1";
				} catch {
					return false;
				}
			});
			config.progress.navigatedBackToPage1 = true;
		},
	});

	actions.set("verify-back-on-page1", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.navigatedBackToPage1) return false;
			if (config.progress.verifiedBackOnPage1) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			assert.equal(items.length, 10, "Page 1 should show 10 items after navigating back");

			const activePage = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
			const activeText = await activePage.getText();
			assert.equal(activeText, "1", "Page 1 should be active after navigating back");

			config.progress.verifiedBackOnPage1 = true;
		},
	});

	return actions;
}
