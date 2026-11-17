import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const ACCOUNT_EMAIL = "reader@gmail.com";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

const CONNECT_GMAIL = '[data-test-integration="gmail"] [data-test-integration-action="connect"]';
const CONNECT_DISCLAIMER_OK = '[data-test-confirm-popover="gmail-connect-disclaimer"] [data-test-action="gmail-connect-ok"]';
const METADATA_RECONNECT_BUTTON = "[data-test-gmail-metadata-reconnect] [data-test-gmail-metadata-reconnect-button]";
const CONSENT_GRANT = "[data-test-consent-grant]";

async function createUser(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must create the reader");
	return CreatedUser.parse(await response.json()).userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
	await page.waitForSelector("body.page-readlist");
}

async function seedGmailState(page: Page, input: { userId: string; seed: object }): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, { data: { userId: input.userId, ...input.seed } });
	assert.equal(seeded.status(), 201, "the Gmail fixture must accept the connection seed");
}

function consentPage(consent: URL): string {
	const callback = new URL(z.string().parse(consent.searchParams.get("redirect_uri")));
	callback.searchParams.set("code", "e2e-code");
	callback.searchParams.set("state", z.string().parse(consent.searchParams.get("state")));
	return `<!doctype html><title>Google consent</title><body class="google-consent"><a href="${callback.href}" data-test-consent-grant>Allow</a></body>`;
}

async function standInForGoogleConsent(page: Page): Promise<URL[]> {
	const consents: URL[] = [];
	await page.route(
		(url) => url.pathname === "/newsletters/gmail/connect",
		async (route) => {
			const { "hx-request": _htmx, ...requestHeaders } = route.request().headers();
			const connect = await route.fetch({ headers: requestHeaders, maxRedirects: 0 });
			const { location, ...headers } = connect.headers();
			const consent = new URL(location);
			consents.push(consent);
			await route.fulfill({
				status: 200,
				headers: { ...headers, "content-type": "text/html", "hx-redirect": consent.href },
				body: consentPage(consent),
			});
		},
	);
	await page.route("https://accounts.google.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: consentPage(new URL(route.request().url())) }),
	);
	return consents;
}

async function openAddNewsletters(page: Page): Promise<void> {
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
	await page.locator("[data-test-gmail-add-newsletters]").click();
	await expect(page.locator("#gmail-dialog:popover-open")).toHaveAttribute("data-test-confirm-popover", "gmail-add");
}

async function grantConsent(page: Page): Promise<void> {
	await page.waitForSelector("body.google-consent");
	await clickAndWaitForPageReload(page, page.locator(CONSENT_GRANT));
	await page.waitForSelector("body.page-integrations-gmail");
}

test("a first Gmail connect returns from Google to the connected Gmail page", async ({ page }, testInfo) => {
	const consents = await standInForGoogleConsent(page);
	const email = `gmail-callback-fresh-${testInfo.workerIndex}-${Date.now()}@example.com`;
	await createUser(page, email);
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/newsletters`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations");

	await page.locator(CONNECT_GMAIL).click();
	await clickAndWaitForPageReload(page, page.locator(CONNECT_DISCLAIMER_OK));
	await grantConsent(page);

	assert.equal(consents.length, 1, "the connect form must hand the reader to Google once");
	await expect(page.locator('[data-test-alert="connected"]')).toHaveCount(1);
	await expect(page.locator("[data-test-gmail-account]")).toHaveText(ACCOUNT_EMAIL);
	await expect(page.locator("[data-test-gmail-step]")).toHaveCount(1);
	await expect(page.locator("[data-test-gmail-disconnect]")).toHaveCount(1);
	await openAddNewsletters(page);
	await expect(page.locator("[data-test-gmail-sender-status]")).toHaveAttribute("data-background-request", "");
	await expect(page.locator("[data-test-gmail-discovery-status]")).toHaveAttribute("data-discovery-state", "idle");
});

test("a reconnect for sender discovery asks Google for the connected account and resumes discovery", async ({ page }, testInfo) => {
	const consents = await standInForGoogleConsent(page);
	const email = `gmail-callback-reconnect-${testInfo.workerIndex}-${Date.now()}@example.com`;
	const userId = await createUser(page, email);
	await seedGmailState(page, {
		userId,
		seed: {
			connection: "connected",
			discoveryState: "failed",
			discoveryRequiresReconnect: true,
			completeDiscoveryOnPoll: true,
			discoveredSenders: [{ email: "dan@tldr.tech", name: "TLDR" }],
		},
	});
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/newsletters/gmail`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
	await expect(page.locator("[data-test-gmail-metadata-reconnect]")).toHaveCount(1);

	await clickAndWaitForPageReload(page, page.locator(METADATA_RECONNECT_BUTTON));
	await grantConsent(page);

	assert.equal(consents.length, 1, "the reconnect must hand the reader to Google once");
	assert.equal(consents[0].searchParams.get("login_hint"), ACCOUNT_EMAIL);
	await expect(page.locator('[data-test-alert="connected"]')).toHaveCount(1);
	await expect(page.locator("[data-test-gmail-senders]")).toHaveCount(1);
	await openAddNewsletters(page);
	await expect(page.locator("[data-test-gmail-discovery-status]")).toHaveAttribute("data-discovery-state", "complete");
});
