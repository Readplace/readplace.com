import assert from "node:assert/strict";
import { By } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { ELEMENT_IDS, type FlowAction } from "../e2e";
import { waitForUi } from "./wait-budget";

export interface LogoutProgress {
	loggedOut: boolean;
}

export function createLogoutActions(config: {
	filterProgress: { filterCleared: boolean };
	progress: LogoutProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	actions.set("click-logout", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.filterProgress.filterCleared) return false;
			if (config.progress.loggedOut) return false;
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
			const logoutButton = await driver.findElement(By.id(ELEMENT_IDS.logoutButton));
			await logoutButton.click();

			await waitForUi(driver, async () => {
				try {
					const loginView = await driver.findElement(By.id(ELEMENT_IDS.loginButton));
					return loginView.isDisplayed();
				} catch {
					return false;
				}
			});

			config.progress.loggedOut = true;
		},
	});

	return actions;
}
