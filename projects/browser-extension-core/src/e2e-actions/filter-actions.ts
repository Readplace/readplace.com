import assert from "node:assert/strict";
import { By, Key } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, ELEMENT_IDS, type FlowAction } from "../e2e";
import { waitForUi } from "./wait-budget";

export interface FilterProgress {
	filteredWithMatch: boolean;
	filteredNoMatch: boolean;
	filterCleared: boolean;
}

export function createFilterActions(config: {
	paginationVerified: { verifiedBackOnPage1: boolean };
	progress: FilterProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

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

	actions.set("filter-with-match", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.paginationVerified.verifiedBackOnPage1) return false;
			if (config.progress.filteredWithMatch) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const filterInput = await driver.findElement(By.id(ELEMENT_IDS.filterInput));
			await filterInput.click();
			await filterInput.clear();
			await filterInput.sendKeys("pagination");

			await waitForUi(driver, async () => {
				try {
					const pagination = await driver.findElement(By.id(ELEMENT_IDS.pagination));
					const hidden = await pagination.getAttribute("hidden");
					return hidden !== null;
				} catch {
					return false;
				}
			});

			config.progress.filteredWithMatch = true;
		},
	});

	actions.set("filter-no-match", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.filteredWithMatch) return false;
			if (config.progress.filteredNoMatch) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const filterInput = await driver.findElement(By.id(ELEMENT_IDS.filterInput));
			await filterInput.click();
			await filterInput.clear();
			await filterInput.sendKeys("zzz-no-match-zzz");

			await waitForUi(driver, async () => {
				try {
					const noMatches = await driver.findElement(By.id(ELEMENT_IDS.noMatches));
					const hidden = await noMatches.getAttribute("hidden");
					return hidden === null;
				} catch {
					return false;
				}
			});

			config.progress.filteredNoMatch = true;
		},
	});

	actions.set("clear-filter", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.filteredNoMatch) return false;
			if (config.progress.filterCleared) return false;
			return isListViewVisible(driver);
		},
		async execute(driver: WebDriver): Promise<void> {
			const filterInput = await driver.findElement(By.id(ELEMENT_IDS.filterInput));
			await filterInput.click();
			await filterInput.clear();
			await filterInput.sendKeys("x");
			await filterInput.sendKeys(Key.BACK_SPACE);

			await waitForUi(driver, async () => {
				const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
				return items.length > 0;
			});

			config.progress.filterCleared = true;
		},
	});

	return actions;
}
