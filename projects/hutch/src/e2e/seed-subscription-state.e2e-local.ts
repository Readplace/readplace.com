import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const BANNER = "[data-test-subscription-banner]";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function seedSubscriptionState(
	page: Page,
	params: { userId: string; state: "trialing" | "cancellation-scheduled" | "inactive" },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: params,
	});
	assert.equal(response.status(), 201, "the subscription-state seed endpoint must answer 201");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("Subscription state seed fixture", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("the subscription-state seed endpoint rejects a body with no userId", async ({ page }) => {
		const response = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
			data: { state: "inactive" },
		});
		assert.equal(response.status(), 400, "a body without a userId must be rejected");
	});

	test("a seeded inactive subscription shows the inactive banner on /queue", async ({ page }, testInfo) => {
		const email = `seed-subscription-inactive-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedSubscriptionState(page, { userId, state: "inactive" });

		await loginAs(page, email);
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-readlist");

		await expect(page.locator(BANNER)).toHaveClass(/readlist-subscription--inactive/);
	});

	test("a seeded cancellation-scheduled subscription shows the cancellation-scheduled banner on /queue", async ({
		page,
	}, testInfo) => {
		const email = `seed-subscription-cancellation-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedSubscriptionState(page, { userId, state: "cancellation-scheduled" });

		await loginAs(page, email);
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-readlist");

		await expect(page.locator(BANNER)).toHaveClass(/readlist-subscription--cancellation-scheduled/);
	});
});
