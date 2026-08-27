/* c8 ignore start -- staging-only perf harness, never run under the local suite */
import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

const SIGNUP_BACKDATE_MS = 5000;
const DELETE_ACCOUNT_CONFIRMATION_PHRASE = "delete my account permanently";
const NAVIGATION_TIMEOUT_MS = 30_000;

export interface PerfUser {
	email: string;
	password: string;
}

export function perfUserFor(runId: string): PerfUser {
	return { email: `perf-e2e+${runId}@example.com`, password: "screen-response-perf-2026" };
}

export async function signUpPerfUser(input: {
	page: Page;
	baseURL: string;
	user: PerfUser;
}): Promise<void> {
	const { page, user } = input;
	await page.goto(`${input.baseURL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(user.email);
	await page.locator("#password").fill(user.password);
	await page
		.locator('input[name="loadedAt"]')
		.evaluate((element: HTMLInputElement, backdateMs: number) => {
			element.value = String(Date.now() - backdateMs);
		}, SIGNUP_BACKDATE_MS);
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-queue", { timeout: NAVIGATION_TIMEOUT_MS });
}

export async function dismissOnboarding(input: { page: Page; baseURL: string }): Promise<void> {
	const { page } = input;
	const response = await page.request.post(`${input.baseURL}/queue/dismiss-onboarding`, {
		form: {},
	});
	assert.ok(
		response.ok(),
		`dismissing onboarding answered ${response.status()} — the perf layout would carry the checklist`,
	);
}

export async function deletePerfUser(input: { page: Page; baseURL: string }): Promise<void> {
	const { page, baseURL } = input;
	await page.goto(`${baseURL}/account`, { waitUntil: "domcontentloaded" });
	await page
		.locator("#delete-account-confirmation")
		.fill(DELETE_ACCOUNT_CONFIRMATION_PHRASE);
	await page
		.locator('[data-test-danger-action="delete-account"] button[type="submit"]')
		.click();
	await page.waitForSelector("body.page-home", { timeout: NAVIGATION_TIMEOUT_MS });

	await page.goto(`${baseURL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-login", { timeout: NAVIGATION_TIMEOUT_MS });
}
/* c8 ignore stop */
