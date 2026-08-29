import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { captureTransitionFrames } from "./transition-frames";

const BASE_URL = `http://localhost:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const VIEWPORT = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

async function signUpFreshUser(page: Page, email: string): Promise<void> {
	// Focusing the save bar opens the save tip, which would land in the frames.
	await page
		.context()
		.addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("Saving on the readlist leaves a reviewable transition frame trail", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("the save transition is captured while the article lands", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await signUpFreshUser(page, `readlist-save-transition-${run}@example.com`);
		await page
			.locator('[data-test-form="save-article"] input[name="url"]')
			.fill(`${BASE_URL}/privacy?readlist-save-transition=${run}`);
		await page.locator('[data-test-form="save-article"] button[type="submit"]').click();
		await captureTransitionFrames({ page, flow: "readlist-save" });
		await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
	});
});
