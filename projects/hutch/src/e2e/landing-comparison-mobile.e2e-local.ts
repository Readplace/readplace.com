import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const NARROWEST = { width: 320, height: 800 };

test.describe("landing page comparison table on a phone", () => {
	test.use({ viewport: NARROWEST });

	test(`fits /readwise-reader-alternative on a ${NARROWEST.width}px screen`, async ({ page }) => {
		await page.goto(`${BASE_URL}/readwise-reader-alternative`, { waitUntil: "domcontentloaded" });
		await expect(page.locator("table.lp-comparison")).toBeVisible();
		assert.equal(
			await page.evaluate(pageOverflowsSideways),
			false,
			`/readwise-reader-alternative must not scroll sideways at ${NARROWEST.width}px`,
		);
	});
});
