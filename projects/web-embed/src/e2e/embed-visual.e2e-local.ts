import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;

const FONTS_READY = "document.fonts.ready.then(() => undefined)";
const IMAGES_READY =
	"Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)";

async function waitForPageReady(page: Page, pageMarker: string): Promise<void> {
	await page.waitForSelector(pageMarker);
	await page.evaluate(FONTS_READY);
	await page.waitForFunction(IMAGES_READY, undefined, { timeout: 5000 });
}

test.describe("Embed preview visual regression", () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 1600 });
	});

	test("each background stage matches its baseline screenshot", async ({ page }) => {
		await page.goto(`${BASE_URL}/embed/preview`, { waitUntil: "domcontentloaded" });
		await waitForPageReady(page, '[data-test-page="embed-preview"]');

		for (const bg of ["white", "surface", "dark"] as const) {
			const stage = page.locator(`[data-test-bg="${bg}"] .embed-preview__stage`);
			await expect.soft(stage).toHaveScreenshot(`preview-${bg}-stage.png`);
		}
	});

	test("the hero demo button matches its baseline screenshot", async ({ page }) => {
		await page.goto(`${BASE_URL}/embed`, { waitUntil: "domcontentloaded" });
		await waitForPageReady(page, '[data-test-page="embed"]');
		const hero = page.locator('[data-test="hero-demo"]');
		await expect(hero).toHaveScreenshot("embed-hero-demo.png");
	});

	test("each variant preview on the main page matches its baseline screenshot", async ({ page }) => {
		await page.goto(`${BASE_URL}/embed`, { waitUntil: "domcontentloaded" });
		await waitForPageReady(page, '[data-test-page="embed"]');

		for (const id of ["a", "b", "c"] as const) {
			const preview = page.locator(`[data-test="preview-${id}"]`);
			await expect.soft(preview).toHaveScreenshot(`embed-preview-${id}.png`);
		}
	});
});
