import assert from "node:assert/strict";
import { By, until } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, type FlowAction } from "../e2e";

export interface SaveLinkProgress {
	linkSaved: boolean;
	listVerified: boolean;
	extraLinkSaved: boolean;
}

const EXTRA_LINK_URL = "https://example.com/extra-test-link";
const EXTRA_LINK_TITLE = "Extra Test Link";

export function createSaveLinkActions(config: {
	popupUrl: string;
	testUrl: string;
	testTitle: string;
	popupWindowHandle: string;
	progress: SaveLinkProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	actions.set("navigate-to-save-link", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (config.progress.linkSaved) return false;
			try {
				const loginView = await driver.findElement(By.id("login-view"));
				const loginHidden = await loginView.getAttribute("hidden");
				assert.notEqual(loginHidden, null, "login-view should be hidden after login");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(config.testUrl)}&title=${encodeURIComponent(config.testTitle)}`;
			await driver.get(saveUrl);
			await driver.wait(async () => {
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
			}, 15000);
			config.progress.linkSaved = true;
		},
	});

	actions.set("navigate-to-list-after-save", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.linkSaved) return false;
			if (config.progress.listVerified) return false;
			try {
				const savedView = await driver.findElement(By.id("saved-view"));
				const hidden = await savedView.getAttribute("hidden");
				assert.equal(hidden, null, "saved-view should be visible");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			await driver.get(config.popupUrl);
			await driver.wait(async () => {
				try {
					const listView = await driver.findElement(By.id("list-view"));
					const hidden = await listView.getAttribute("hidden");
					return hidden === null;
				} catch {
					return false;
				}
			}, 15000);
		},
	});

	actions.set("verify-link-in-list", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.linkSaved) return false;
			if (config.progress.listVerified) return false;
			try {
				const listView = await driver.findElement(By.id("list-view"));
				const hidden = await listView.getAttribute("hidden");
				assert.equal(hidden, null, "list-view should be visible");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			await driver.wait(
				until.elementLocated(By.css(CSS_SELECTORS.listItem)),
				15000,
			);
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			const hrefs = await Promise.all(items.map(el => el.getAttribute("href")));
			const readUrlPattern = /\/queue\/[a-f0-9]+\/view$/;
			assert.ok(
				hrefs.some(href => href !== null && (href === config.testUrl || readUrlPattern.test(href))),
				`Expected "${config.testUrl}" or a reader URL in list hrefs, but found: ${hrefs.join(", ")}`,
			);
			config.progress.listVerified = true;
		},
	});

	/** Saves a second non-"pagination" URL so the queue ends up with 12 items
	 * total but only 10 match the filter — keeps the pagination assertion
	 * (page 2 = 2 items) and the filter-with-match assertion (filter hides
	 * pagination because ≤10 matches) consistent now that the popup's auto-save
	 * for chrome-extension:// no longer adds a stub. */
	actions.set("save-extra-link", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.listVerified) return false;
			if (config.progress.extraLinkSaved) return false;
			try {
				const listView = await driver.findElement(By.id("list-view"));
				const hidden = await listView.getAttribute("hidden");
				return hidden === null;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(EXTRA_LINK_URL)}&title=${encodeURIComponent(EXTRA_LINK_TITLE)}`;
			await driver.get(saveUrl);
			await driver.wait(async () => {
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
			}, 15000);
			await driver.get(config.popupUrl);
			await driver.wait(async () => {
				try {
					const listView = await driver.findElement(By.id("list-view"));
					const hidden = await listView.getAttribute("hidden");
					return hidden === null;
				} catch {
					return false;
				}
			}, 15000);
			config.progress.extraLinkSaved = true;
		},
	});

	return actions;
}
