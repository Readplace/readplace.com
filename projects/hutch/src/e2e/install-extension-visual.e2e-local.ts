import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const PANEL = '[data-test-panel="browser"]';
const VIDEO = "[data-test-video]";
const OUTRO = '[data-test-section="browser-setup-outro"]';
const DESKTOP = { width: 1280, height: 900 };

const STATIC_ASSETS = join(__dirname, "..", "..", "static-assets");
const STATIC_ORIGIN = "https://static.test";

const BROWSERS = [
	{ client: "chrome", cta: "download-chrome", poster: "chrome-save-demo-poster.webp" },
	{ client: "firefox", cta: "download-firefox", poster: "firefox-save-demo-poster.webp" },
] as const;

for (const browser of BROWSERS) {
	assert.ok(
		existsSync(join(STATIC_ASSETS, "videos", browser.poster)),
		`${browser.client} panel needs its poster at static-assets/videos/${browser.poster}`,
	);
}

async function serveStaticAssets(page: Page): Promise<void> {
	await page.route(`${STATIC_ORIGIN}/**`, (route) => {
		const file = join(STATIC_ASSETS, new URL(route.request().url()).pathname);
		return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
	});
}

async function openBrowserPanel(page: Page, client: string): Promise<void> {
	await serveStaticAssets(page);
	await page.goto(`${BASE_URL}/install?client=${client}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-install");
	await page.waitForSelector(`[data-test-tab="${client}"].install-page__tab--active`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function posterDecoded(page: Page): Promise<void> {
	await page.waitForSelector(`${VIDEO} video[poster]`);
	await page.evaluate(async (selector) => {
		const video = document.querySelector(`${selector} video`);
		if (!(video instanceof HTMLVideoElement)) throw new Error(`no video under ${selector}`);
		const image = new Image();
		image.src = video.poster;
		await image.decode();
	}, VIDEO);
}

async function ctaLeadsTheRecording(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const video = await measuredBox(page, VIDEO);
	const outro = await measuredBox(page, OUTRO);
	assert.ok(
		video.x >= panel.x && video.x + video.width <= panel.x + panel.width,
		"the recording must sit inside the panel rather than overflow it",
	);
	assert.ok(
		video.y + video.height <= outro.y,
		"the outro must follow the recording, so nothing narrates it before it plays",
	);
}

function checkpoint(client: string, scheme: string): VisualCheckpoint {
	return {
		name: `install-${client}-panel-${scheme}`,
		settled: posterDecoded,
		geometry: ctaLeadsTheRecording,
		target: PANEL,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Browser extension install panels", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const browser of BROWSERS) {
		test(`teaches the ${browser.client} save flow with its own recording (light)`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: "light" });
			await openBrowserPanel(page, browser.client);
			await page.waitForSelector(`[data-test-cta="${browser.cta}"]`);
			await captureCheckpoint(page, checkpoint(browser.client, "light"));
		});
	}
});
