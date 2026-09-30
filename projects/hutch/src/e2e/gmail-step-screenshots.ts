import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { waitForImagePixels } from "@packages/e2e-harness";
import { scrollToTop } from "./gmail-newsletters-visual.browser";

const STATIC_ASSETS = join(__dirname, "..", "..", "static-assets");
const STEP_SHOTS = ['[data-test-gmail-shot="see-all-settings"]', '[data-test-gmail-shot="add-forwarding-address"]'];

export async function serveGmailStepScreenshots(page: Page): Promise<void> {
	await page.route("**/screenshots/gmail-*.webp", (route) => {
		const file = join(STATIC_ASSETS, new URL(route.request().url()).pathname);
		assert.ok(existsSync(file), `the forwarding step needs its screenshot at ${file}`);
		return route.fulfill({ path: file });
	});
}

export async function waitForGmailStepScreenshots(page: Page): Promise<void> {
	for (const shot of STEP_SHOTS) {
		await page.locator(shot).scrollIntoViewIfNeeded();
		await waitForImagePixels(page, shot);
	}
	await page.evaluate(scrollToTop);
}
