import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
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

const CONSENT_CARD = "body.page-oauth-authorize .auth-card";
const CONSENT_PASSWORD = "password123";
const CONNECTOR_REDIRECT_URI = "https://chatgpt.com/connector/oauth/cb";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const DESKTOP = { width: 1280, height: 900 };

const RegisteredClient = z.object({ client_id: z.string() });
const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);

async function openMcpConsent(page: Page, email: string): Promise<void> {
	const registration = await page.request.post(`${BASE_URL}/oauth/register`, {
		data: { redirect_uris: [CONNECTOR_REDIRECT_URI], client_name: "ChatGPT" },
	});
	assert.equal(registration.status(), 201, "the connector must register itself");
	const { client_id } = RegisteredClient.parse(await registration.json());

	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: CONSENT_PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	assert(CreatedUser.parse(await created.json()).ok, "the consent user must be created");

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(CONSENT_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	const authorizeUrl = new URL(`${BASE_URL}/oauth/authorize`);
	authorizeUrl.searchParams.set("client_id", client_id);
	authorizeUrl.searchParams.set("redirect_uri", CONNECTOR_REDIRECT_URI);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("code_challenge", CODE_CHALLENGE);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	await page.goto(authorizeUrl.toString(), { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-oauth-authorize");
	await page.waitForSelector(`${CONSENT_CARD} form[method="POST"]`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function approveSitsInsideTheCard(page: Page): Promise<void> {
	const card = await measuredBox(page, CONSENT_CARD);
	const approve = await measuredBox(page, `${CONSENT_CARD} button[value="approve"]`);
	assert.ok(
		approve.x >= card.x && approve.x + approve.width <= card.x + card.width,
		"the approve button must sit inside the consent card rather than overflow it",
	);
}

function consentCheckpoint(name: string, email: string): VisualCheckpoint {
	return {
		name,
		settled: (page) => openMcpConsent(page, email),
		geometry: approveSitsInsideTheCard,
		target: CONSENT_CARD,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("MCP connector consent page", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("shows the self-registered connector consent card (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await captureCheckpoint(page, consentCheckpoint("oauth-consent-mcp-light", "connector-consent-light@example.com"));
	});

	test("shows the self-registered connector consent card (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await captureCheckpoint(page, consentCheckpoint("oauth-consent-mcp-dark", "connector-consent-dark@example.com"));
	});
});
