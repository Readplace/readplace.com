import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const ACCOUNT_CARD = "[data-test-account-card]";
const PANEL = '[data-test-confirm-popover="subscribe-plans"]';
const OPEN_TRIGGER = `${ACCOUNT_CARD} [data-test-action="subscribe-plans-open"]`;
const MONTHLY_PLAN = `${PANEL} [data-test-plan="monthly"]`;
const SUBMIT = `${PANEL} [data-test-action="subscribe-plans-submit"]`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function signInTrialingReader(
	page: Page,
	input: { stamp: string; checkout: "opens" | "fails-next" },
): Promise<void> {
	const email = `subscribe-checkout-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: { userId, state: "trialing", checkout: input.checkout },
	});
	assert.equal(seeded.status(), 201, "the subscription-state seed endpoint must answer 201");

	await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function submitMonthlyPlan(page: Page): Promise<void> {
	await page.click(OPEN_TRIGGER);
	await page.waitForSelector(`${PANEL}:popover-open`);
	await page.click(MONTHLY_PLAN);
	await expect(page.locator(`${MONTHLY_PLAN} input[name="plan"]`)).toBeChecked();
	await clickAndWaitForPageReload(page, page.locator(SUBMIT));
}

async function openAccount(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

function navigationTo(page: Page, matches: (path: string) => boolean): Promise<unknown> {
	return page.waitForRequest((request) => request.isNavigationRequest() && matches(new URL(request.url()).pathname));
}

async function paysThroughCheckout(page: Page): Promise<void> {
	const hostedCheckout = navigationTo(page, (path) => path.startsWith("/e2e/stripe-checkout/"));
	const checkoutSuccess = navigationTo(page, (path) => path === "/auth/checkout/success");
	await submitMonthlyPlan(page);
	await Promise.all([hostedCheckout, checkoutSuccess]);
	await page.waitForSelector("body.page-readlist");
}

async function accountShowsActive(page: Page): Promise<void> {
	await openAccount(page);
	await expect(page.locator(ACCOUNT_CARD)).toHaveAttribute("data-test-account-state", "active");
}

test.describe("Subscribing from the account page through hosted checkout", () => {
	test("a trialing reader picks monthly, pays, lands on the readlist and the account shows active", async ({ page }) => {
		await signInTrialingReader(page, { stamp: `pays-${Date.now()}`, checkout: "opens" });
		await openAccount(page);

		await paysThroughCheckout(page);

		await accountShowsActive(page);
	});

	test("a failed checkout shows the retry state, and retrying from that card pays", async ({ page }) => {
		await signInTrialingReader(page, { stamp: `retry-${Date.now()}`, checkout: "fails-next" });
		await openAccount(page);

		await submitMonthlyPlan(page);
		await page.waitForSelector(`${ACCOUNT_CARD}[data-test-account-state="error-subscribe-failed"]`);

		await paysThroughCheckout(page);

		await accountShowsActive(page);
	});
});
