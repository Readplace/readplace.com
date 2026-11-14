import assert from "node:assert/strict";
import { By } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, READER_PERMALINK_PATTERN, type FlowAction } from "../e2e";
import { waitForUi } from "./wait-budget";

export interface TokenExpiryProgress {
	savedAfterExpiry: boolean;
	listAfterExpiry: boolean;
}

async function isViewVisible(driver: WebDriver, id: string): Promise<boolean> {
	try {
		const view = await driver.findElement(By.id(id));
		return (await view.getAttribute("hidden")) === null;
	} catch {
		return false;
	}
}

async function waitForSavedRow(driver: WebDriver, testUrl: string): Promise<void> {
	await waitForUi(
		driver,
		async () => {
			if (!(await isViewVisible(driver, "list-view"))) return false;
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			const hrefs = await Promise.all(items.map((item) => item.getAttribute("href")));
			return hrefs.some((href) => href !== null && (href === testUrl || READER_PERMALINK_PATTERN.test(href)));
		},
		"the list view never showed the saved row after the access token expired",
	);
}

export function createTokenExpiryActions(config: {
	popupUrl: string;
	serverUrl: string;
	testEmail: string;
	testUrl: string;
	testTitle: string;
	saveLinkProgress: { extraLinkSaved: boolean };
	progress: TokenExpiryProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	async function expireAccessTokens(): Promise<void> {
		const response = await fetch(`${config.serverUrl}/e2e/expire-access-tokens`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: config.testEmail }),
		});
		assert.equal(response.status, 200, `POST /e2e/expire-access-tokens returned ${response.status}`);
		const { expired } = await response.json();
		assert.ok(expired >= 1, `expected at least one access token to expire, but ${expired} did`);
	}

	actions.set("expire-then-save", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.saveLinkProgress.extraLinkSaved) return false;
			if (config.progress.savedAfterExpiry) return false;
			return isViewVisible(driver, "list-view");
		},
		async execute(driver: WebDriver): Promise<void> {
			await expireAccessTokens();
			const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(config.testUrl)}&title=${encodeURIComponent(config.testTitle)}`;
			await driver.get(saveUrl);
			await waitForUi(
				driver,
				() => isViewVisible(driver, "saved-view"),
				"the saved view never appeared for a save made with an expired access token",
			);
			config.progress.savedAfterExpiry = true;
		},
	});

	actions.set("expire-then-load-list", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.savedAfterExpiry) return false;
			if (config.progress.listAfterExpiry) return false;
			return isViewVisible(driver, "saved-view");
		},
		async execute(driver: WebDriver): Promise<void> {
			await expireAccessTokens();
			const readlistButton = await driver.findElement(By.css(CSS_SELECTORS.savedViewReadlistButton));
			await readlistButton.click();
			await waitForSavedRow(driver, config.testUrl);
			config.progress.listAfterExpiry = true;
		},
	});

	return actions;
}
