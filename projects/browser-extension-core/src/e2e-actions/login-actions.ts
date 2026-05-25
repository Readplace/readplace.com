import { By, until } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { ELEMENT_IDS, CSS_SELECTORS, type FlowAction } from "../e2e";

export function createLoginActions(config: {
	testEmail: string;
	testPassword: string;
	popupWindowHandle: string;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	actions.set("click-login", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			try {
				const button = await driver.findElement(By.id(ELEMENT_IDS.loginButton));
				return button.isDisplayed();
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const button = await driver.findElement(By.id(ELEMENT_IDS.loginButton));
			await button.click();
		},
	});

	actions.set("switch-to-login-tab", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			const handles = await driver.getAllWindowHandles();
			return handles.length > 1;
		},
		async execute(driver: WebDriver): Promise<void> {
			const handles = await driver.getAllWindowHandles();
			const newTab = handles.find((h) => h !== config.popupWindowHandle);
			if (!newTab) throw new Error("No new tab found for login");
			await driver.switchTo().window(newTab);
			await driver.wait(until.elementLocated(By.id(ELEMENT_IDS.emailInput)), 30000);
		},
	});

	actions.set("submit-login-form", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			try {
				const emailInput = await driver.findElement(By.id(ELEMENT_IDS.emailInput));
				return emailInput.isDisplayed();
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const emailInput = await driver.findElement(By.id(ELEMENT_IDS.emailInput));
			await emailInput.clear();
			await emailInput.sendKeys(config.testEmail);
			const passwordInput = await driver.findElement(By.id(ELEMENT_IDS.passwordInput));
			await passwordInput.clear();
			await passwordInput.sendKeys(config.testPassword);
			const submitButton = await driver.findElement(
				By.css(CSS_SELECTORS.submitButton),
			);
			await submitButton.click();
		},
	});

	actions.set("approve-oauth", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			try {
				const button = await driver.findElement(
					By.css(CSS_SELECTORS.approveButton),
				);
				return button.isDisplayed();
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const button = await driver.findElement(
				By.css(CSS_SELECTORS.approveButton),
			);
			await button.click();
		},
	});

	actions.set("switch-to-popup", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			try {
				const url = await driver.getCurrentUrl();
				return url.includes("/oauth/callback");
			} catch {
				return true;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			await driver.switchTo().window(config.popupWindowHandle);
		},
	});

	return actions;
}
