import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { EXPERIMENT_COOKIE_NAME } from "../runtime/web/experiments/homepage-assignment";
import { HOMEPAGE_SPLIT } from "../runtime/web/experiments/homepage-split";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const HERO = '[data-test-section="hero"]';
const PASTE_FORM = '[data-test-hero-form="homepage-link-input"]';
const CAPABILITIES = '[data-test-section="capabilities"]';
const VIEWPORTS = [
	{ label: "mobile", size: { width: 390, height: 844 } },
	{ label: "desktop", size: { width: 1280, height: 900 } },
];

async function openArm(page: Page, slug: string): Promise<void> {
	await page.context().addCookies([{
		name: EXPERIMENT_COOKIE_NAME,
		value: `${HOMEPAGE_SPLIT.campaign}:${HOMEPAGE_SPLIT.epoch}:${slug}`,
		url: BASE_URL,
	}]);
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-home");
	await waitForBrandFonts(page, ["Inter"]);
}

async function heroSettled(page: Page): Promise<void> {
	await page.waitForSelector(PASTE_FORM);
}

async function pasteFormSitsInsideTheHero(page: Page): Promise<void> {
	const hero = await measuredBox(page, HERO);
	const form = await measuredBox(page, PASTE_FORM);
	assert.ok(
		form.x >= hero.x && form.x + form.width <= hero.x + hero.width && form.y + form.height <= hero.y + hero.height,
		"the paste form must sit inside the hero rather than overflow it",
	);
}

async function capabilitiesSettled(page: Page): Promise<void> {
	await page.waitForSelector(`${CAPABILITIES} [data-test-capability="epub"]`);
}

async function capabilitiesSitInsideTheirSection(page: Page): Promise<void> {
	const section = await measuredBox(page, CAPABILITIES);
	const epub = await measuredBox(page, '[data-test-capability="epub"]');
	assert.ok(
		epub.x + epub.width <= section.x + section.width && epub.y + epub.height <= section.y + section.height,
		"the last capability must sit inside its section rather than overflow it",
	);
}

for (const variant of HOMEPAGE_SPLIT.variants) {
	for (const viewport of VIEWPORTS) {
		test.describe(`Homepage arm ${variant.marker} hero at ${viewport.label} width`, () => {
			test.use({ timezoneId: "UTC", viewport: viewport.size });

			test("renders the paste-box hero", async ({ page }) => {
				await openArm(page, variant.slug);
				const hero: VisualCheckpoint = {
					name: `home-${variant.marker}-hero-${viewport.label}-light`,
					settled: heroSettled,
					geometry: pasteFormSitsInsideTheHero,
					target: HERO,
					capture: "element",
					pinnedText: [],
				};
				await captureCheckpoint(page, hero);
			});
		});
	}
}

for (const viewport of VIEWPORTS) {
	test.describe(`Homepage arm C capabilities at ${viewport.label} width`, () => {
		test.use({ timezoneId: "UTC", viewport: viewport.size });

		test("renders what happens to what you keep", async ({ page }) => {
			await openArm(page, HOMEPAGE_SPLIT.variants[1].slug);
			const capabilities: VisualCheckpoint = {
				name: `home-c-capabilities-${viewport.label}-light`,
				settled: capabilitiesSettled,
				geometry: capabilitiesSitInsideTheirSection,
				target: CAPABILITIES,
				capture: "element",
				pinnedText: [],
			};
			await captureCheckpoint(page, capabilities);
		});
	});
}
