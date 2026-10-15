import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { waitForBrandFonts } from "@packages/e2e-harness";
import { z } from "zod";

export const CONNECTOR_REDIRECT_URI = "https://chatgpt.com/connector/oauth/cb";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CONSENT_PASSWORD = "password123";

const RegisteredClient = z.object({ client_id: z.string() });
const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function registerConnector(page: Page, input: { baseUrl: string }): Promise<string> {
	const registration = await page.request.post(`${input.baseUrl}/oauth/register`, {
		data: { redirect_uris: [CONNECTOR_REDIRECT_URI], client_name: "ChatGPT" },
	});
	assert.equal(registration.status(), 201, "the connector must register itself");
	return RegisteredClient.parse(await registration.json()).client_id;
}

async function signInConsentUser(page: Page, input: { baseUrl: string; email: string }): Promise<void> {
	const created = await page.request.post(`${input.baseUrl}/e2e/users`, {
		data: { email: input.email, password: CONSENT_PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	assert(CreatedUser.parse(await created.json()).ok, "the consent user must be created");

	await page.goto(`${input.baseUrl}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(input.email);
	await page.locator("#password").fill(CONSENT_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

export async function gotoConsent(
	page: Page,
	input: { baseUrl: string; clientId: string; redirectUri: string },
): Promise<void> {
	const authorizeUrl = new URL(`${input.baseUrl}/oauth/authorize`);
	authorizeUrl.searchParams.set("client_id", input.clientId);
	authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("code_challenge", CODE_CHALLENGE);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	await page.goto(authorizeUrl.toString(), { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-oauth-authorize");
	await page.waitForSelector('body.page-oauth-authorize .auth-card form[method="POST"]');
	await waitForBrandFonts(page, ["Inter"]);
}

export async function openMcpConsent(page: Page, input: { baseUrl: string; email: string }): Promise<void> {
	const clientId = await registerConnector(page, { baseUrl: input.baseUrl });
	await signInConsentUser(page, input);
	await gotoConsent(page, { baseUrl: input.baseUrl, clientId, redirectUri: CONNECTOR_REDIRECT_URI });
}

export async function openBuiltInConsent(
	page: Page,
	input: { baseUrl: string; clientId: string; redirectUri: string; email: string },
): Promise<void> {
	await signInConsentUser(page, { baseUrl: input.baseUrl, email: input.email });
	await gotoConsent(page, { baseUrl: input.baseUrl, clientId: input.clientId, redirectUri: input.redirectUri });
}
