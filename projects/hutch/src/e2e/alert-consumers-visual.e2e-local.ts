import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const DESKTOP = { width: 1280, height: 900 };
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

type AlertVariant = "error" | "warning" | "success" | "info";
type Theme = "light" | "dark";
type Scenario = {
	name: string;
	key: string;
	variant: AlertVariant;
	open: (page: Page, stamp: string) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
};

async function createUser(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must create the reader");
	return CreatedUser.parse(await response.json()).userId;
}

async function loginAs(page: Page, email: string, password = PASSWORD): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
	await page.waitForSelector("body.page-readlist");
}

async function openIntegrations(page: Page, stamp: string, path: string): Promise<void> {
	const email = `alert-integrations-${stamp}@example.com`;
	await createUser(page, email);
	await loginAs(page, email);
	await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
}

async function openAccount(
	page: Page,
	stamp: string,
	input: { error: string; state: "inactive" | "cancellation-scheduled" },
): Promise<void> {
	const email = `alert-account-${stamp}@example.com`;
	const userId = await createUser(page, email);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: { userId, state: input.state },
	});
	assert.equal(seeded.status(), 201, "the account visual needs a customer subscription");
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/account?error=${input.error}`, { waitUntil: "domcontentloaded" });
}

async function openTruncatedImport(page: Page): Promise<void> {
	const links = Array.from({ length: 2_001 }, (_, index) => `https://example.com/post-${index}`);
	const uploaded = await page.request.post(`${BASE_URL}/import`, {
		multipart: {
			file: {
				name: "urls.txt",
				mimeType: "text/plain",
				buffer: Buffer.from(links.join("\n")),
			},
		},
		maxRedirects: 0,
	});
	assert.equal(uploaded.status(), 303, "the import must redirect to its review page");
	const location = uploaded.headers().location;
	assert(location, "the upload redirect must name its review page");
	await page.goto(new URL(location, BASE_URL).href, { waitUntil: "domcontentloaded" });
}

async function openGmailSuccess(page: Page, stamp: string): Promise<void> {
	const email = `alert-gmail-${stamp}@example.com`;
	const userId = await createUser(page, email);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: { userId, discoveryState: "complete", completeDiscoveryOnStart: true },
	});
	assert.equal(seeded.status(), 201, "the Gmail visual needs a connected account");
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/integrations/gmail?notice=connected`, { waitUntil: "domcontentloaded" });
}

async function openLoginError(page: Page, stamp: string): Promise<void> {
	const email = `alert-auth-${stamp}@example.com`;
	await createUser(page, email);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill("wrong-password");
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
}

async function openAdminNotFound(page: Page): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
	});
	assert.equal(created.status(), 201, "the admin fixture must answer the create request");
	await loginAs(page, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
	await page.goto(`${BASE_URL}/admin/extend-trial`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill("nobody-e2e@example.com");
	await clickAndWaitForPageReload(page, page.locator("[data-test-extend-trial-lookup]"));
}

const SCENARIOS: readonly Scenario[] = [
	{
		name: "save-error",
		key: "save-error",
		variant: "error",
		open: async (page) => {
			await page.clock.install({ time: new Date("2026-09-28T12:00:00.000Z") });
			await page.clock.pauseAt(new Date("2026-09-28T12:00:01.000Z"));
			await page.goto(`${BASE_URL}/save`, { waitUntil: "domcontentloaded" });
			await page.locator('meta[http-equiv="refresh"]').evaluate((element) => element.remove());
		},
		pinnedText: [{ selector: ".save-error__seconds", text: "5" }],
	},
	{
		name: "import-error",
		key: "import",
		variant: "error",
		open: async (page) => {
			await page.goto(`${BASE_URL}/import?mode=upload&error_code=import_no_urls`, { waitUntil: "domcontentloaded" });
		},
		pinnedText: [],
	},
	{
		name: "import-truncated",
		key: "import-truncated",
		variant: "warning",
		open: openTruncatedImport,
		pinnedText: [],
	},
	{
		name: "integrations-error",
		key: "oauth_state",
		variant: "error",
		open: (page, stamp) => openIntegrations(page, stamp, "/integrations?error=oauth_state"),
		pinnedText: [],
	},
	{
		name: "integrations-notice",
		key: "gmail_disconnected",
		variant: "info",
		open: (page, stamp) => openIntegrations(page, stamp, "/integrations?notice=gmail_disconnected"),
		pinnedText: [],
	},
	{
		name: "gmail-notice",
		key: "connected",
		variant: "success",
		open: openGmailSuccess,
		pinnedText: [],
	},
	{
		name: "account-subscription-error",
		key: "account-subscription",
		variant: "error",
		open: (page, stamp) => openAccount(page, stamp, { error: "payment_method", state: "inactive" }),
		pinnedText: [],
	},
	{
		name: "account-card-notice",
		key: "card-notice",
		variant: "error",
		open: (page, stamp) => openAccount(page, stamp, { error: "add_card_failed", state: "cancellation-scheduled" }),
		pinnedText: [],
	},
	{
		name: "auth-login",
		key: "global-error",
		variant: "error",
		open: openLoginError,
		pinnedText: [],
	},
	{
		name: "admin-not-found",
		key: "extend-trial-not-found",
		variant: "error",
		open: openAdminNotFound,
		pinnedText: [],
	},
];

function checkpoint(scenario: Scenario, theme: Theme): VisualCheckpoint {
	const selector = `[data-test-alert="${scenario.key}"]`;
	return {
		name: `alert-${scenario.name}-${theme}`,
		target: selector,
		capture: "element",
		pinnedText: scenario.pinnedText,
		settled: async (page) => {
			const alert = page.locator(selector);
			await expect(alert).toBeVisible();
			await expect(alert).toHaveAttribute("data-test-alert-variant", scenario.variant);
			await expect(alert).toHaveAttribute("role", scenario.variant === "error" ? "alert" : "status");
			await expect(alert).toHaveClass(/alert--visible/);
		},
		geometry: async (page) => {
			const box = await measuredBox(page, selector);
			const icon = await measuredBox(page, `${selector} .alert__icon`);
			const content = await measuredBox(page, `${selector} .alert__content`);
			assert.equal(Math.round(icon.width), 24, "the alert icon must occupy 24px");
			assert.equal(Math.round(icon.height), 24, "the alert icon must occupy 24px");
			assert.equal(Math.round(icon.x - box.x), 16, "the icon must start at the 16px inset");
			assert.equal(Math.round(content.x - icon.x - icon.width), 12, "the text must follow the icon by 12px");
			const style = await page.locator(selector).evaluate((element) => {
				const computed = getComputedStyle(element);
				return { radius: computed.borderRadius, padding: computed.paddingTop };
			});
			assert.equal(style.radius, "8px", "the alert must have 8px corners");
			assert.equal(style.padding, "15px", "the border and padding must make a 16px inset");
		},
	};
}

test.describe("Inline alert consumers", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const scenario of SCENARIOS) {
		for (const theme of ["light", "dark"] as const) {
			test(`shows ${scenario.name} (${theme})`, async ({ page }, testInfo) => {
				await page.emulateMedia({ colorScheme: theme });
				await scenario.open(page, `${scenario.name}-${theme}-${testInfo.workerIndex}-${Date.now()}`);
				await captureCheckpoint(page, checkpoint(scenario, theme));
			});
		}
	}
});
