import assert from "node:assert/strict";
import type { Page, Request } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { seedChromeGrant } from "./oauth-revoke/seed-grant";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const SECTION = "[data-test-connected-apps]";
const CHROME_ROW = '[data-test-connected-app-client="hutch-chrome-extension"]';
const OPEN = `${CHROME_ROW} [data-test-action="disconnect-app-open"]`;
const DIALOG = '[data-test-confirm-popover="disconnect-app"][data-test-confirm-subject="hutch-chrome-extension"]';
const DIALOG_FORM = `${DIALOG} form`;
const CANCEL = `${DIALOG} [data-test-action="disconnect-app-cancel"]`;
const COMMIT = `${DIALOG} [data-test-action="disconnect-app-confirm"]`;
const SEE_WAYS_TO_SAVE = '[data-test-connected-app-action="see-ways-to-save"]';

async function signInWithChrome(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await seedChromeGrant(page.request, BASE_URL);
}

async function openConnectedApps(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account#connected-apps`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
	await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "listed");
}

async function openDisconnectDialog(page: Page): Promise<void> {
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

test.describe("Signing a connected app out from all devices on the account page", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test("Cancel, Esc and the scrim close the dialog, keep the app and return focus to its Sign out from all devices", async ({
		page,
	}, testInfo) => {
		await signInWithChrome(page, `connected-apps-dismiss-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openConnectedApps(page);
		const requests = requestLog(page);
		const dismissals: { name: string; dismiss: (page: Page) => Promise<void> }[] = [
			{ name: "Cancel", dismiss: (each) => each.locator(CANCEL).click() },
			{ name: "Esc", dismiss: (each) => each.keyboard.press("Escape") },
			{ name: "the scrim", dismiss: (each) => each.mouse.click(4, 4) },
		];

		for (const { name, dismiss } of dismissals) {
			await openDisconnectDialog(page);
			await expect(page.locator(COMMIT), `the dialog opens on its Sign out from all devices before ${name}`).toBeFocused();
			await dismiss(page);
			await expect(page.locator(`${DIALOG}:popover-open`), `${name} closes the dialog`).toHaveCount(0);
			await expect(page.locator(CHROME_ROW), `${name} keeps the Chrome row`).toHaveCount(1);
			await expect(page.locator(OPEN), `${name} returns focus to the row's Sign out from all devices`).toBeFocused();
		}

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "listed");
		expect(requests).toContain("GET /account");
		expect(requests.filter((line) => line.startsWith("POST "))).toEqual([]);
	});

	test("Sign out from all devices swaps the page in place and leaves the empty row with its way to save", async ({
		page,
	}, testInfo) => {
		await signInWithChrome(page, `connected-apps-commit-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openConnectedApps(page);
		await page.evaluate(() => Reflect.set(window, "connectedAppsMarker", "same document"));
		await openDisconnectDialog(page);

		await page.locator(COMMIT).click();

		await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "empty");
		expect(await page.evaluate(() => Reflect.get(window, "connectedAppsMarker"))).toBe("same document");
		await expect(page.locator(`${SECTION} ${SEE_WAYS_TO_SAVE}`)).toBeVisible();
		await expect(page.locator(`${SECTION} ${SEE_WAYS_TO_SAVE}`)).toHaveAttribute("href", /utm_source=account/);
	});

	test("keeps Cancel legible and shows the in-flight dots while the sign-out is in flight", async ({
		page,
	}, testInfo) => {
		await signInWithChrome(page, `connected-apps-held-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openConnectedApps(page);
		await openDisconnectDialog(page);

		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(
			(url) => url.pathname === "/account/connected-apps/hutch-chrome-extension/disconnect",
			async (route) => {
				await held;
				await route.continue();
			},
		);
		await page.locator(COMMIT).click();

		await expect(page.locator(DIALOG_FORM)).toHaveClass(/htmx-request/);
		await expect(page.locator(CANCEL)).toBeVisible();
		await expect(page.locator(`${COMMIT} .account__action-loader`)).toBeVisible();
		await expect(page.locator(`${COMMIT} .account__action-label`)).toBeHidden();
		assert(release, "the held sign-out must expose its release");
		release();

		await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "empty");
	});
});
