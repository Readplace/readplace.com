import { WebElementCondition, type Condition, type WebDriver, type WebElement } from "selenium-webdriver";

/** 1. Ceilings, not durations: waits return the moment their condition holds,
 *     so wide ceilings cost a passing run nothing. The scattered 5-30s ones
 *     blew intermittently when parallel nx runs starved the browser (the UI
 *     arrived late, not never); 60s absorbs contention while keeping a genuine
 *     failure bounded. */
const UI_CONDITION_WAIT_MS = 60_000; /* 1 */
const SERVER_START_WAIT_MS = 90_000; /* 1 */

/** Hard whole-suite deadline for the unref'd failsafe timer each e2e main
 * arms: a test cancelled by --test-timeout skips its teardown, and the
 * orphaned e2e-server child then holds the process open forever. Must exceed
 * server start + the phase's --test-timeout + teardown. */
export const SUITE_FAILSAFE_MS = 8 * 60_000;

export async function waitForServer(url: string): Promise<void> {
	const deadline = Date.now() + SERVER_START_WAIT_MS;
	while (Date.now() < deadline) {
		try {
			await fetch(url, { redirect: "manual" });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`e2e server did not respond at ${url} within ${SERVER_START_WAIT_MS}ms`);
}

export function waitForUi(
	driver: WebDriver,
	condition: WebElementCondition,
	message?: string,
): Promise<WebElement>;
export function waitForUi<T>(
	driver: WebDriver,
	condition: Condition<T> | ((driver: WebDriver) => Promise<T>),
	message?: string,
): Promise<T>;
export function waitForUi<T>(
	driver: WebDriver,
	condition: WebElementCondition | Condition<T> | ((driver: WebDriver) => Promise<T>),
	message?: string,
): Promise<T | WebElement> {
	if (condition instanceof WebElementCondition) {
		return driver.wait(condition, UI_CONDITION_WAIT_MS, message);
	}
	return driver.wait(condition, UI_CONDITION_WAIT_MS, message);
}
