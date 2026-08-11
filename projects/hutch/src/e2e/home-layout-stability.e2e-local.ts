import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { HOMEPAGE_SPLIT } from "../runtime/web/experiments/homepage-split";
import { test } from "@packages/e2e-harness";
import { openHomepage } from "./home-control-arm";
import { type StabilityReport, sampleLayoutStability } from "./layout-stability.browser";

/** Long enough to span at least two swaps of the slowest rotator the homepage
 * runs today (the slogan heading, 4s), so a heading that resizes on swap is
 * caught rather than sampled between two swaps. A rotator added later with a
 * longer period needs this raised to match. */
const RESTING_WINDOW_MS = 9_000;
const SETTLED_AT_BOTTOM_MS = 5_000;
const SAMPLE_EVERY_MS = 100;
const SCROLL_STEPS = 8;
const SCROLL_SETTLE_MS = 250;

/** Chrome driven by host state rather than by the page: the offline banner
 * follows `navigator.onLine`, the trial countdown follows the clock. A Wi-Fi
 * drop mid-run would otherwise read as the page moving on its own. */
const VOLATILE_CHROME = [".trial-countdown", ".offline-banner"];

const VIEWPORT = { width: 390, height: 844 };

async function detachVolatileChrome(page: Page): Promise<void> {
	await page.evaluate((selectors) => {
		for (const selector of selectors) document.querySelector(selector)?.remove();
	}, VOLATILE_CHROME);
}

async function scrollToBottom(page: Page): Promise<void> {
	for (let step = 1; step <= SCROLL_STEPS; step++) {
		await page.evaluate((fraction) => {
			window.scrollTo({ top: document.body.scrollHeight * fraction, behavior: "instant" });
		}, step / SCROLL_STEPS);
		await page.waitForTimeout(SCROLL_SETTLE_MS);
	}
}

function expectNothingMoved(report: StabilityReport, watched: string): void {
	assert.ok(
		report.sampled > 1,
		`${watched}: the window must take more than one sample to compare, took ${report.sampled}`,
	);
	assert.deepEqual(
		report.moved.map((moved) => `${moved.element} sat at ${moved.offsets.join(" then ")}`),
		[],
		`${watched}: every element must hold its place once the page has settled`,
	);
	assert.equal(
		report.pageHeights.length,
		1,
		`${watched}: the page must keep one height, measured ${report.pageHeights.join(" then ")}`,
	);
}

test.describe("Homepage settles and then stops moving", () => {
	test.use({ viewport: VIEWPORT });

	for (const variant of HOMEPAGE_SPLIT.variants) {
		test(`arm "${variant.slug}" holds still while it sits on screen`, async ({ page }) => {
			await openHomepage(page, { variant, clientBundle: "live" });
			await detachVolatileChrome(page);

			expectNothingMoved(
				await page.evaluate(sampleLayoutStability, {
					duration: RESTING_WINDOW_MS,
					interval: SAMPLE_EVERY_MS,
				}),
				"resting at the top",
			);

			await scrollToBottom(page);
			expectNothingMoved(
				await page.evaluate(sampleLayoutStability, {
					duration: SETTLED_AT_BOTTOM_MS,
					interval: SAMPLE_EVERY_MS,
				}),
				"resting at the bottom",
			);
		});
	}
});
