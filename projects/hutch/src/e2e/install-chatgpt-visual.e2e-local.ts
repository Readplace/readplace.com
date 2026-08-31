import assert from "node:assert/strict";
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

const PANEL = '[data-test-panel="ai"]';
const DIRECT_INSTALL_CTA = '[data-test-cta="ai-direct-install"]';
const SERVER_URL_ROW = '[data-test-section="ai-server-url"]';
const REVEALED_COPY_BUTTON = "[data-install-copy]:not([hidden])";
const MINIMUM_TOUCH_TARGET_PX = 44;

const DESKTOP = { width: 1280, height: 900 };

async function openChatGptPanel(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/install?client=chatgpt`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-install");
	await page.waitForSelector('[data-test-tab="chatgpt"].install-page__tab--active');
	await waitForBrandFonts(page, ["Inter"]);
}

async function copyButtonsRevealed(page: Page): Promise<void> {
	await page.waitForSelector(REVEALED_COPY_BUTTON);
}

async function oneClickInstallLeadsTheManualSetup(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const cta = await measuredBox(page, DIRECT_INSTALL_CTA);
	const serverUrl = await measuredBox(page, SERVER_URL_ROW);
	assert.ok(
		cta.height >= MINIMUM_TOUCH_TARGET_PX,
		`the plugin install must be at least ${MINIMUM_TOUCH_TARGET_PX}px tall to be tapped, measured ${cta.height}px`,
	);
	assert.ok(
		cta.x >= panel.x && cta.x + cta.width <= panel.x + panel.width,
		"the plugin install must sit inside the panel rather than overflow it",
	);
	assert.ok(
		cta.y + cta.height <= serverUrl.y,
		"the one-click plugin install must lead, with the manual server URL below it",
	);
}

const CHATGPT_PANEL_LIGHT: VisualCheckpoint = {
	name: "install-chatgpt-panel-light",
	settled: copyButtonsRevealed,
	geometry: oneClickInstallLeadsTheManualSetup,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

test.describe("ChatGPT install panel", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("leads with the official one-click ChatGPT plugin (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openChatGptPanel(page);
		await captureCheckpoint(page, CHATGPT_PANEL_LIGHT);
	});
});
