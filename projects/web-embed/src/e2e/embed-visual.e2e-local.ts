import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test, waitForBrandFonts } from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;

const IMAGES_READY =
	"Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)";

async function waitForPageReady(page: Page, pageMarker: string): Promise<void> {
	await page.waitForSelector(pageMarker);
	await waitForBrandFonts(page, ["Inter"]);
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

test.describe("Embed page without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("keeps every Copy button hidden, leaving the selectable source", async ({ page }) => {
		await page.goto(`${BASE_URL}/embed`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector('[data-test-page="embed"]');

		for (const id of ["a", "b", "c", "privacy"] as const) {
			const copy = page.locator(`[data-test="copy-${id}"]`);
			await expect(copy).toHaveCount(1);
			await expect(copy).toBeHidden();
		}
	});
});

test.describe("Embed article link field", () => {
	for (const width of [1280, 320] as const) {
		test(`lines the field up with its button and never scrolls sideways at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`${BASE_URL}/embed`, { waitUntil: "domcontentloaded" });
			await waitForPageReady(page, '[data-test-page="embed"]');

			const field = await page.locator('form [name="url"]').boundingBox();
			const submit = await page.locator('form:has([name="url"]) [type="submit"]').boundingBox();
			assert(field, "the article link field must be laid out");
			assert(submit, "the Update snippets button must be laid out");
			expect(field.height).toBe(48);
			expect(submit.height).toBe(48);

			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			expect(scrollWidth).toBeLessThanOrEqual(width);
		});
	}

	test("rewrites every snippet and its byte count as the link is typed, and reveals Copy", async ({ page }) => {
		await page.goto(`${BASE_URL}/embed`, { waitUntil: "domcontentloaded" });
		await waitForPageReady(page, '[data-test-page="embed"]');

		await page.locator('form [name="url"]').fill("https://example.com/a");

		await expect(page.locator('[data-test="source-a"]')).toContainText(
			"https://readplace.com/save?url=https%3A%2F%2Fexample.com%2Fa&amp;save_surface=embed",
		);
		const source = await page.locator('[data-test="source-a"]').textContent();
		assert(source, "source-a must carry the rewritten snippet");
		await expect(page.locator('[data-test="bytes-a"]')).toHaveText(
			`${Buffer.byteLength(source, "utf-8").toLocaleString("en-US")} bytes`,
		);
		await expect(page.locator('[data-test="copy-a"]')).toBeVisible();
	});
});
