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

const PAGINATION_LINK_COUNT = 10;
const PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} .pagination__page`;
const ACTIVE_PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} .pagination__page--active`;
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

async function waitForPage(
	driver: WebDriver,
	expected: { label: string; itemCount: number },
): Promise<void> {
	await waitForUi(driver, async () => {
		try {
			const active = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
			if ((await active.getText()) !== expected.label) return false;
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			return items.length === expected.itemCount;
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
			const pageButtons = await driver.findElements(By.css(PAGE_SELECTOR));
			let clicked = false;
			for (const button of pageButtons) {
				if ((await button.getText()) !== "2") continue;
				await button.click();
				clicked = true;
				break;
			}
			assert.ok(clicked, "the server should advertise a page 2 control");
			await waitForPage(driver, { label: "2", itemCount: 2 });
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
			assert.equal(items.length, 2, "Page 2 should show the 2 items the server put there");

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
			await waitForPage(driver, { label: "1", itemCount: 10 });
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
