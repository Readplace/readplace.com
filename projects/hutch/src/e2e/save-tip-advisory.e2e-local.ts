import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://localhost:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const SETTLE_MS = 45000;

async function signUpFreshUser(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("The save tip meets a reader at the URL box", () => {
	test("opens on a click into the bar, survives its own release, and never holds the save back", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await signUpFreshUser(page, `save-tip-advisory-${run}@example.com`);

		const form = page.locator('[data-test-form="save-article"]');
		await expect(form).toHaveAttribute("data-save-tip", "due");

		// A real press-release-click: a panel opened before the release would be
		// light-dismissed by this very click, so a visible panel proves it waited.
		await form.locator('input[name="url"]').click();

		const saveTip = page.locator("[data-test-confirm-popover='save-tip']");
		await expect(saveTip).toBeVisible();

		await saveTip.locator("[data-test-action='save-tip-acknowledge']").click();
		await expect(saveTip).toBeHidden();

		// Nothing has been saved yet, so only the panel's own record can have
		// spent the session's one warning.
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(form).toHaveAttribute("data-save-tip", "seen");

		await form.locator('input[name="url"]').fill(`${BASE_URL}/privacy?save-tip=${run}`);
		await form.locator('button[type="submit"]').click();
		await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
	});

	// The import box is the cheapest URL field a reader reaches logged out, and
	// a keyboard focus takes the immediate path the pointer one defers.
	test("opens for a reader who tabs into a URL box rather than clicking it", async ({ page }) => {
		await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-form="import-from-url"]')).toHaveAttribute(
			"data-save-tip",
			"due",
		);

		await page.locator("[data-test-import-from-url-input]").focus();

		await expect(page.locator("[data-test-confirm-popover='save-tip']")).toBeVisible();
	});
});
