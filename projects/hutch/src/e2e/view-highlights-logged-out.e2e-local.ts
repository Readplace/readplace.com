import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { selectPassage } from "./highlight-a-passage.browser";
import { backdateFormLoad } from "./import-logged-out.browser";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;

const CONTENT = ".article-body__content";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const MARK = `${CONTENT} mark.article-highlight`;
const CARD_ROW = "[data-test-view-highlight-row]";
const KEEP_POPUP = "#view-highlights-keep";
const RAIL_ROW = "[data-test-highlight-row]";

const KEPT_PASSAGES = [
	"deterministic, path-uniqued article",
	"hard-coded production page",
	"every request returns the same body",
	"Reusing a single shared article path",
	"The summariser short-circuits",
];
const ONE_TOO_MANY = "Mozilla's Readability extractor";

async function openReadableView(page: Page, articleUrl: string): Promise<void> {
	const viewUrl = `${BASE_URL}/view?url=${encodeURIComponent(articleUrl)}`;
	await page.goto(viewUrl, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT, { timeout: SETTLE_MS });
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-view");
	await expect(page.locator(TOOLBAR)).toHaveCount(1);
}

async function highlight(page: Page, exact: string): Promise<void> {
	await page.locator(CONTENT).getByText(exact, { exact: false }).scrollIntoViewIfNeeded();
	await page.evaluate(selectPassage, { root: CONTENT, exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(HIGHLIGHT_BUTTON).click();
}

async function signUp(page: Page, email: string): Promise<void> {
	await page.waitForSelector("body.page-signup");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate(backdateFormLoad);
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="signup"]'));
}

test("a logged-out visitor keeps five highlights in the browser, then carries them into a new account", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${Date.now()}`;
	await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-${stamp}`);

	await highlight(page, KEPT_PASSAGES[0]);
	await expect(page.locator(MARK).filter({ hasText: KEPT_PASSAGES[0] })).toHaveCount(1);
	await expect(page.locator(CARD_ROW)).toHaveCount(1);

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(MARK).filter({ hasText: KEPT_PASSAGES[0] })).toHaveCount(1);
	await expect(page.locator(CARD_ROW)).toHaveCount(1);

	for (const passage of KEPT_PASSAGES.slice(1)) {
		await highlight(page, passage);
		await expect(page.locator(MARK).filter({ hasText: passage })).toHaveCount(1);
	}
	await expect(page.locator(CARD_ROW)).toHaveCount(KEPT_PASSAGES.length);

	await highlight(page, ONE_TOO_MANY);
	await expect(page.locator(`${KEEP_POPUP}:popover-open`)).toHaveCount(1);
	await expect(page.locator(MARK).filter({ hasText: ONE_TOO_MANY })).toHaveCount(0);

	await clickAndWaitForPageReload(
		page,
		page.locator(`${KEEP_POPUP} [data-test-action="view-highlights-signup"]`),
	);
	await signUp(page, `view-highlights-${stamp}@example.com`);

	await page.waitForSelector("body.page-reader", { timeout: SETTLE_MS });
	await expect(page.locator(RAIL_ROW)).toHaveCount(KEPT_PASSAGES.length);
	for (const passage of KEPT_PASSAGES) {
		await expect(page.locator(RAIL_ROW).filter({ hasText: passage })).toHaveCount(1);
	}
});
