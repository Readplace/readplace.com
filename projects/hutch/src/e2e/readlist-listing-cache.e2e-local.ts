import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { readListingFromBrowser, saveArticleFromBrowser } from "./readlist-listing-cache.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

async function createVerifiedUser(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("Queue listing browser cache", () => {
	test("serves a repeat queue read from the browser's own cache, and stops once a save intervenes", async ({
		page,
	}, testInfo) => {
		const email = `queue-listing-cache-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await page.context().unrouteAll({ behavior: "ignoreErrors" });

		const listing = `${BASE_URL}/queue`;

		const cold = await page.evaluate(readListingFromBrowser, listing);
		expect(cold.status).toBe(200);
		expect(cold.transferSize).toBeGreaterThan(0);

		const repeat = await page.evaluate(readListingFromBrowser, listing);
		expect(repeat.status).toBe(200);
		expect(repeat.transferSize).toBe(0);

		await page.evaluate(saveArticleFromBrowser, {
			saveUrl: `${BASE_URL}/queue/save`,
			articleUrl: "https://example.com/browser-cache-proof",
		});

		const afterSave = await page.evaluate(readListingFromBrowser, listing);
		expect(afterSave.status).toBe(200);
		expect(afterSave.transferSize).toBeGreaterThan(0);
	});
});
