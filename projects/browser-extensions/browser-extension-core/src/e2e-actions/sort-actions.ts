import assert from "node:assert/strict";
import { By } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, ELEMENT_IDS, type FlowAction } from "../e2e";
import { waitForUi } from "./wait-budget";

export interface SortProgress {
	sortedOldestFirst: boolean;
}

const ACTIVE_PAGE_SELECTOR = `#${ELEMENT_IDS.pagination} .pagination__page--current`;

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

async function rowLinks(driver: WebDriver): Promise<string[]> {
	const rows = await driver.findElements(By.css(CSS_SELECTORS.listItem));
	return Promise.all(
		rows.map(async (row) => {
			const link = await row.getAttribute("href");
			assert.ok(link, "every row should link to its article");
			return link;
		}),
	);
}

export function createSortActions(config: {
	filterProgress: { filterCleared: boolean };
	progress: SortProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	actions.set("sort-oldest-first", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.filterProgress.filterCleared) return false;
			if (config.progress.sortedOldestFirst) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const newestFirst = await rowLinks(driver);
			assert.ok(newestFirst.length > 0, "the newest-first page should list saved articles");

			const sortButton = await driver.findElement(By.id(ELEMENT_IDS.sortButton));
			await sortButton.click();

			await waitForUi(driver, async () => {
				try {
					const button = await driver.findElement(By.id(ELEMENT_IDS.sortButton));
					if ((await button.getText()) !== "Oldest first") return false;
					const active = await driver.findElement(By.css(ACTIVE_PAGE_SELECTOR));
					if ((await active.getText()) !== "1") return false;
					const [firstRow] = await rowLinks(driver);
					return firstRow !== undefined && !newestFirst.includes(firstRow);
				} catch {
					return false;
				}
			});

			config.progress.sortedOldestFirst = true;
		},
	});

	return actions;
}
