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

test.describe("The save tip meets a reader at the Add link field", () => {
	test("opens with the dialog, hands the field back on every dismissal, and never holds the save back", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await signUpFreshUser(page, `save-tip-advisory-${run}@example.com`);

		const addLink = page.locator('[data-test-action="add-link"]');
		const dialog = page.locator("#add-link");
		const form = dialog.locator('[data-test-form="save-article"]');
		const field = form.locator('input[name="url"]');
		const saveTip = page.locator("[data-test-confirm-popover='save-tip']");
		await expect(form).toHaveAttribute("data-save-tip", "due");
		await page.waitForLoadState("domcontentloaded");

		await addLink.click();

		await expect(dialog).toBeVisible();
		await expect(saveTip).toBeVisible();
		await expect(saveTip.locator("[data-test-action='save-tip-continue']")).toBeFocused();
		expect(await page.evaluate(() => document.cookie)).toContain("rp_save_tip=seen");

		await saveTip.locator("[data-test-action='save-tip-continue']").click();
		await expect(saveTip).toBeHidden();
		await expect(dialog).toBeVisible();
		await expect(field).toBeFocused();

		const draft = `${BASE_URL}/privacy?save-tip=${run}`;
		await field.fill(draft);
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(addLink).toBeFocused();

		await addLink.click();
		await expect(dialog).toBeVisible();
		await expect(field).toBeFocused();
		await expect(field).toHaveValue(draft);
		await expect(saveTip).toBeHidden();

		await dialog.locator('[data-test-action="add-link-cancel"]').click();
		await expect(dialog).toBeHidden();
		await expect(addLink).toBeFocused();

		// Nothing has been saved yet, so only the panel's own record can have
		// spent the session's one warning.
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(form).toHaveAttribute("data-save-tip", "seen");

		await addLink.click();
		await expect(saveTip).toBeHidden();
		await field.fill(draft);
		await form.locator('button[type="submit"]').click();
		await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(dialog).toBeHidden();
	});

	test("hands the field back when the reader presses Escape on the advice", async ({ page }, testInfo) => {
		await signUpFreshUser(page, `save-tip-escape-${testInfo.workerIndex}-${Date.now()}@example.com`);
		const dialog = page.locator("#add-link");
		const saveTip = page.locator("[data-test-confirm-popover='save-tip']");

		await page.locator('[data-test-action="add-link"]').click();
		await expect(saveTip).toBeVisible();
		await page.keyboard.press("Escape");

		await expect(saveTip).toBeHidden();
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('input[name="url"]')).toBeFocused();
	});

	// The import box is the cheapest URL field a reader reaches logged out, and
	// a keyboard focus takes the immediate path the pointer one defers.
	test("opens for a reader who tabs into a URL box rather than clicking it", async ({ page }) => {
		await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-form="import-from-url"]')).toHaveAttribute(
			"data-save-tip",
			"due",
		);

		await page.locator('[data-test-action="import-from-url-submit"]').focus();
		await page.keyboard.press("Shift+Tab");

		const saveTip = page.locator("[data-test-confirm-popover='save-tip']");
		await expect(saveTip).toBeVisible();
		await expect(saveTip.locator("[data-test-action='save-tip-continue']")).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(saveTip).toBeHidden();
		await expect(page.locator("[data-test-import-from-url-input]")).toBeFocused();
	});
});
