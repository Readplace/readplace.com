import assert from "node:assert/strict";
import type { Page, Request } from "@playwright/test";
import { expect, measuredBox, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONFIRMATION_PHRASE = "delete my account permanently";

const OPEN = "[data-test-danger-open]";
const DIALOG = '[data-test-confirm-popover="delete-account"]';
const DIALOG_FORM = '[data-test-danger-form="dialog"]';
const DIALOG_INPUT = "#delete-account-confirmation-dialog";
const CANCEL = '[data-test-action="delete-account-cancel"]';
const COMMIT = '[data-test-action="delete-account-confirm"]';
const THEME_OPTION = "[data-test-appearance-option]";
const THEME_ROW = "[data-test-account-appearance] .account-row";
const DANGER_ROW = "[data-test-account-danger] .account-row";

async function signIn(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openAccount(page: Page, query = ""): Promise<void> {
	await page.goto(`${BASE_URL}/account${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

async function openDeleteDialog(page: Page): Promise<void> {
	await page.locator(OPEN).click();
	await page.waitForSelector(`${DIALOG}:popover-open`);
}

function requestLog(page: Page): string[] {
	const lines: string[] = [];
	page.on("request", (request: Request) => {
		lines.push(`${request.method()} ${new URL(request.url()).pathname}`);
	});
	return lines;
}

test.describe("Deleting the account from the account page", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test("deletes the account through the dialog, keeping Cancel legible while the delete is in flight", async ({
		page,
	}, testInfo) => {
		await signIn(page, `account-delete-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page);
		await openDeleteDialog(page);
		await page.locator(DIALOG_INPUT).fill(CONFIRMATION_PHRASE);

		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(
			(url) => url.pathname === "/account/delete",
			async (route) => {
				await held;
				await route.continue();
			},
		);
		await page.locator(`${DIALOG_FORM} ${COMMIT}`).click();

		await expect(page.locator(DIALOG_FORM)).toHaveClass(/htmx-request/);
		await expect(page.locator(`${DIALOG_FORM} ${CANCEL}`)).toBeVisible();
		await expect(page.locator(`${DIALOG_FORM} ${COMMIT} .account__action-loader`)).toBeVisible();
		await expect(page.locator(`${DIALOG_FORM} ${COMMIT} .account__action-label`)).toBeHidden();
		assert(release, "the held delete must expose its release");
		release();

		await page.waitForSelector("body.page-home");
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-login");
	});

	test("a phrase that does not match is refused before it leaves the page", async ({ page }, testInfo) => {
		await signIn(page, `account-delete-refused-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page);
		const requests = requestLog(page);
		await openDeleteDialog(page);
		await page.locator(DIALOG_INPUT).fill("Delete My Account Permanently");

		await page.locator(`${DIALOG_FORM} ${COMMIT}`).click();

		expect(await page.locator(DIALOG_INPUT).evaluate((input) => input.matches(":invalid"))).toBe(true);
		await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(1);
		await openAccount(page);
		expect(requests.filter((line) => line.startsWith("POST "))).toEqual([]);
	});

	test("Cancel closes the dialog and deletes nothing", async ({ page }, testInfo) => {
		await signIn(page, `account-delete-cancel-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page);
		const requests = requestLog(page);
		await openDeleteDialog(page);
		await page.locator(DIALOG_INPUT).fill(CONFIRMATION_PHRASE);

		await page.locator(`${DIALOG_FORM} ${CANCEL}`).click();

		await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(0);
		await expect(page.locator("body.page-account")).toHaveCount(1);
		await openAccount(page);
		expect(requests.filter((line) => line.startsWith("POST "))).toEqual([]);
	});
});

test.describe("The account page on a narrow phone", () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test("nothing scrolls sideways, and the Theme options wrap two and one", async ({ page }, testInfo) => {
		await signIn(page, `account-narrow-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page);

		expect(await page.evaluate(pageOverflowsSideways)).toBe(false);
		const tops = await page
			.locator(THEME_OPTION)
			.evaluateAll((options: HTMLElement[]) => options.map((option) => option.offsetTop));
		expect(tops).toHaveLength(3);
		expect(tops[1]).toBe(tops[0]);
		expect(tops[2]).toBeGreaterThan(tops[0]);
	});
});

test.describe("The account page below the 768px breakpoint", () => {
	test.use({ viewport: { width: 700, height: 900 } });

	test("drops the Theme options under the row's text instead of squeezing the text beside them", async ({
		page,
	}, testInfo) => {
		await signIn(page, `account-tablet-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page);

		const text = await measuredBox(page, `${THEME_ROW} .account-row__text`);
		const actions = await measuredBox(page, `${THEME_ROW} .account-row__actions`);
		expect(actions.y).toBeGreaterThanOrEqual(text.y + text.height);
	});
});

test.describe("The refused delete on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("ends the Danger zone row 24px under its description, keeping no room for the hidden trigger", async ({
		page,
	}, testInfo) => {
		await signIn(page, `account-refused-phone-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openAccount(page, "?error=delete_confirmation");

		const description = await measuredBox(page, `${DANGER_ROW} .account-row__description`);
		const row = await measuredBox(page, DANGER_ROW);
		expect(row.y + row.height - (description.y + description.height)).toBeCloseTo(24, 0);
	});
});
