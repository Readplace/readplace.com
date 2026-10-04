import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { captureCheckpoint, expect, measuredBox, test, waitForBrandFonts, waitForImagePixels } from "@packages/e2e-harness";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CARD = "main.readlist [data-test-onboarding]";
const STEP = '[data-test-onboarding-step="connect-gmail"]';
const CONNECT = `${STEP} [data-test-onboarding-action="connect-gmail"]`;
const DISMISS = `${STEP} [data-test-onboarding-action="gmail-dismiss"]`;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

async function login(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`);
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
	await expect(page.locator("body.page-readlist")).toHaveCount(1);
}

async function createReader(page: Page, stamp: string): Promise<string> {
	const email = `onboarding-gmail-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { email, password: PASSWORD, verified: true } });
	assert.equal(created.status(), 201);
	await login(page, email);
	await page.context().addCookies([
		{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE, url: BASE_URL },
		{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE, url: BASE_URL },
	]);
	const done = await page.request.post(`${BASE_URL}/queue/onboarding/email/done`);
	assert.equal(done.status(), 200);
	await page.goto(`${BASE_URL}/queue`);
	await expect(page.locator(CONNECT)).toBeVisible();
	return email;
}

const DEVICES = [
	{ name: "desktop", viewport: { width: 1280, height: 1000 }, userAgent: CHROME, hasClient: true },
	{ name: "mobile", viewport: { width: 390, height: 1000 }, userAgent: CHROME, hasClient: true },
	{ name: "safari", viewport: { width: 1280, height: 1000 }, userAgent: SAFARI, hasClient: false },
	{ name: "android", viewport: { width: 390, height: 1000 }, userAgent: ANDROID, hasClient: false },
] as const;

for (const device of DEVICES) {
	test.describe(`Gmail onboarding on ${device.name}`, () => {
		test.use({ timezoneId: "UTC", viewport: device.viewport, userAgent: device.userAgent });
		for (const theme of ["light", "dark"] as const) {
			test(`shows Gmail (${theme})`, async ({ page }, testInfo) => {
				await page.emulateMedia({ colorScheme: theme });
				await createReader(page, `${device.name}-${theme}-${testInfo.workerIndex}-${Date.now()}`);
				await captureCheckpoint(page, {
					name: `onboarding-gmail-${device.name}-${theme}`,
					target: CARD,
					capture: "element",
					pinnedText: [],
					settled: async (settledPage) => {
						await waitForBrandFonts(settledPage, ["Inter"]);
						if (device.hasClient) await waitForImagePixels(settledPage, ".setup-guide__avatar");
						await expect(settledPage.locator(STEP)).toHaveAttribute("data-test-onboarding-current", "true");
						await expect(settledPage.locator(DISMISS)).toBeVisible();
						await expect(settledPage.locator("[data-test-onboarding-progress]")).toHaveAttribute("data-test-onboarding-progress", device.hasClient ? "60" : "0");
					},
					geometry: async (settledPage) => {
						const row = await measuredBox(settledPage, STEP);
						for (const selector of [CONNECT, DISMISS]) {
							const control = await measuredBox(settledPage, selector);
							assert(control.x >= row.x && control.x + control.width <= row.x + row.width);
							assert(control.y >= row.y && control.y + control.height <= row.y + row.height);
						}
						assert.equal(await settledPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
					},
				});
			});
		}
	});
}

test.describe("Gmail onboarding with htmx", () => {
	test.use({ userAgent: CHROME });

	test("opens Integrations and dismisses Gmail through boosted forms", async ({ page }, testInfo) => {
		await createReader(page, `htmx-${testInfo.workerIndex}-${Date.now()}`);
		await clickAndWaitForPageReload(page, page.locator(CONNECT));
		await expect(page.locator("body.page-integrations")).toHaveCount(1);
		expect(new URL(page.url()).searchParams.get("utm_content")).toBe("connect-gmail");
		await page.goto(`${BASE_URL}/queue?tab=done&order=asc`);
		await clickAndWaitForPageReload(page, page.locator(DISMISS));
		await expect(page.locator(STEP)).toHaveCount(0);
		await expect(page.locator("[data-test-onboarding-progress]")).toHaveAttribute("data-test-onboarding-progress", "80");
		expect(new URL(page.url()).search).toBe("?tab=done&order=asc");
	});
});

test.describe("Gmail onboarding without JavaScript", () => {
	test.use({ javaScriptEnabled: false, userAgent: CHROME });

	test("opens Integrations with tracking and permanently dismisses across browser sessions", async ({ page }, testInfo) => {
		const email = await createReader(page, `no-js-${testInfo.workerIndex}-${Date.now()}`);
		await clickAndWaitForPageReload(page, page.locator(CONNECT));
		await expect(page.locator("body.page-integrations")).toHaveCount(1);
		expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ utm_source: "onboarding", utm_medium: "internal", utm_content: "connect-gmail" });
		await page.goto(`${BASE_URL}/queue?tab=done&order=asc`);
		await clickAndWaitForPageReload(page, page.locator(DISMISS));
		expect(new URL(page.url()).search).toBe("?tab=done&order=asc");
		await expect(page.locator(STEP)).toHaveCount(0);
		await expect(page.locator("[data-test-onboarding-progress]")).toHaveAttribute("data-test-onboarding-progress", "80");
		await page.context().clearCookies();
		await login(page, email);
		await expect(page.locator(STEP)).toHaveCount(0);
	});
});

test.describe("Unsupported-device dismissal without JavaScript", () => {
	test.use({ javaScriptEnabled: false, userAgent: SAFARI });

	test("dismisses the no-app notice independently and hides the checklist once Gmail is dismissed", async ({ page }, testInfo) => {
		await createReader(page, `no-app-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator("[data-test-onboarding-no-client]")).toBeVisible();
		await clickAndWaitForPageReload(page, page.locator("[data-test-onboarding-dismiss]"));
		await expect(page.locator("[data-test-onboarding-no-client]")).toBeHidden();
		await expect(page.locator(CONNECT)).toBeVisible();
		await clickAndWaitForPageReload(page, page.locator(DISMISS));
		await expect(page.locator(STEP)).toHaveCount(0);
		await expect(page.locator(CARD)).toBeHidden();
	});

	test("keeps the no-app notice visible when only Gmail is dismissed", async ({ page }, testInfo) => {
		await createReader(page, `gmail-only-${testInfo.workerIndex}-${Date.now()}`);
		await clickAndWaitForPageReload(page, page.locator(DISMISS));
		await expect(page.locator(STEP)).toHaveCount(0);
		await expect(page.locator("[data-test-onboarding-no-client]")).toBeVisible();
	});
});
