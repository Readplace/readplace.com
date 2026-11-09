import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const NOTE_IMAGE = join(__dirname, "..", "..", "static-assets", "screenshots", "obsidian-note.png");
const HERO = '[data-test-section="lp-hero"]';
const PROOF = '[data-test-section="lp-proof"]';
const PANEL = '[data-test-panel="obsidian"]';
const INSTALL_CTA = '[data-test-cta="obsidian-install"]';

async function settle(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: [".offline-banner", ".newer-version-banner", "[data-test-changelog-banner]"],
		times: [],
	});
}

async function fitsViewport(page: Page): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Obsidian pages must not scroll sideways");
}

async function noteDecoded(page: Page): Promise<void> {
	await settle(page);
	const image = page.locator(`${PROOF} img`);
	await image.scrollIntoViewIfNeeded();
	await image.evaluate((element) => (element as HTMLImageElement).decode());
	expect(await image.evaluate((element) => {
		const note = element as HTMLImageElement;
		return [note.naturalWidth, note.naturalHeight];
	})).toEqual([1200, 800]);
}

async function installButtonFits(page: Page): Promise<void> {
	await fitsViewport(page);
	const panel = await measuredBox(page, PANEL);
	const cta = await measuredBox(page, INSTALL_CTA);
	assert.ok(cta.height >= 44, "the install button must be large enough to tap");
	assert.ok(
		cta.x >= panel.x && cta.x + cta.width <= panel.x + panel.width,
		"the install button must fit inside the panel",
	);
}

for (const screen of [
	{ name: "desktop", viewport: { width: 1280, height: 900 } },
	{ name: "phone", viewport: { width: 390, height: 844 } },
]) {
	test.describe(`Obsidian setup on ${screen.name}`, () => {
		test.use({ viewport: screen.viewport, timezoneId: "UTC", colorScheme: "light" });

		test("shows a real synced note and opens the matching installation panel", async ({ page }) => {
			await page.route("https://static.test/screenshots/obsidian-note.png", (route) => route.fulfill({ path: NOTE_IMAGE }));
			await page.goto(`${BASE_URL}/obsidian-read-it-later`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-landing")).toHaveCount(1);
			await captureCheckpoint(page, {
				name: `obsidian-landing-hero-${screen.name}`,
				settled: settle,
				geometry: fitsViewport,
				target: HERO,
				capture: "element",
				pinnedText: [],
			});
			await captureCheckpoint(page, {
				name: `obsidian-landing-note-${screen.name}`,
				settled: noteDecoded,
				geometry: fitsViewport,
				target: PROOF,
				capture: "element",
				pinnedText: [],
			});
			await page.locator(`${HERO} [data-test-cta="install"]`).click();
			await expect(page.locator("body.page-install")).toHaveCount(1);
			await expect(page.locator('[data-test-tab="obsidian"]')).toHaveAttribute("aria-current", "page");
			await expect(page.locator(INSTALL_CTA)).toHaveAttribute("href", "https://community.obsidian.md/plugins/readplace");
			await captureCheckpoint(page, {
				name: `obsidian-install-panel-${screen.name}`,
				settled: settle,
				geometry: installButtonFits,
				target: PANEL,
				capture: "element",
				pinnedText: [],
			});
		});
	});
}
