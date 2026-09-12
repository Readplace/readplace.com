import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { GmailAccountEmail } from "@packages/domain/gmail";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import { GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const CONNECT = "/integrations/gmail/connect";
const CALLBACK = "/integrations/gmail/callback";
const ONE_DAY_MS = 86_400_000;

function grantOk(): GmailGrantResult {
	return {
		ok: true,
		grant: {
			refreshToken: "refresh-value",
			accessToken: "access-value",
			grantedScope: GMAIL_SCOPES,
		},
	};
}

function fixtureWithGmail(
	grant: GmailGrantResult = grantOk(),
	accountEmail: GmailApiResult<GmailAccountEmail> = { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
) {
	const gmail = initInMemoryGmailIntegration({ grant, accountEmail });
	const fixture = {
		...createDefaultTestAppFixture(TEST_APP_ORIGIN),
		gmailIntegration: gmail.bundle,
	};
	return {
		fixture,
		gmailCredentialsStore: gmail.bundle.gmailCredentialsStore,
		gmailConnectionStore: gmail.bundle.gmailConnectionStore,
		codes: gmail.exchangedCodes,
	};
}

/** Completes the consent redirect the way Google does: the state cookie the
 * connect route set is echoed back as the `state` query parameter. */
async function connectAndCallback(
	agent: ReturnType<typeof loginAgent> extends Promise<infer A> ? A : never,
	overrides: { code?: string; state?: string } = {},
) {
	const started = await agent.post(CONNECT).send();
	const authorizeUrl = new URL(started.headers.location);
	const state = overrides.state ?? authorizeUrl.searchParams.get("state") ?? "";
	return agent.get(CALLBACK).query({ code: overrides.code ?? "auth-code", state });
}

describe("POST /integrations/gmail/connect", () => {
	it("requests settings and message metadata access, offline and with forced consent", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(CONNECT).send();

		expect(response.status).toBe(303);
		const url = new URL(response.headers.location);
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPES);
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("test-client-id");
		expect(url.searchParams.get("redirect_uri")).toBe(`${TEST_APP_ORIGIN}${CALLBACK}`);
	});

	it("hands an htmx client an HX-Redirect to Google instead of a cross-origin 303", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(CONNECT).set("HX-Request", "true").send();

		expect(response.status).toBe(200);
		expect(response.headers.location).toBeUndefined();
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "an htmx connect must carry an HX-Redirect header");
		const url = new URL(hxRedirect);
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
	});

	it("requires a signed-in reader", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);

		const response = await request(harness.server).post(CONNECT).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("redirects a read-only reader to /queue?inactive=1 without starting the grant", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post(CONNECT).set("Accept", "text/html").send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("blocks a locked reader with the account-locked screen", async () => {
		const { fixture } = fixtureWithGmail();
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(CONNECT).set("Accept", "text/html").send();

		expect(new JSDOM(response.text).window.document.querySelector("h1")?.textContent).toBe(
			"Your account is locked",
		);
	});
});

describe("GET /integrations/gmail/callback", () => {
	it("stores the refresh token and reports the connection", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore, codes } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=connected");
		expect(codes).toEqual(["auth-code"]);
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBe("refresh-value");
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.accountEmail).toBe("reader@gmail.com");
	});

	it("records the connected mailbox address on a first connect", async () => {
		const accountEmail = GmailAccountEmailSchema.parse("reader@gmail.com");
		const { fixture, gmailConnectionStore } = fixtureWithGmail(grantOk(), {
			ok: true,
			value: accountEmail,
		});
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		await connectAndCallback(agent);

		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.accountEmail).toBe(
			accountEmail,
		);
	});

	it("records the connected mailbox address on a reconnect of an existing row", async () => {
		const accountEmail = GmailAccountEmailSchema.parse("reader@gmail.com");
		const { fixture, gmailConnectionStore } = fixtureWithGmail(grantOk(), {
			ok: true,
			value: accountEmail,
		});
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await connectAndCallback(agent);
		const first = await gmailConnectionStore.findConnectionByUserId(userId);

		await connectAndCallback(agent);

		const second = await gmailConnectionStore.findConnectionByUserId(userId);
		expect(second?.accountEmail).toBe(accountEmail);
		expect(second?.gatewayAddress).toBe(first?.gatewayAddress);
	});

	it.each(["different@gmail.com", undefined])("requires disconnect before replacing a connection whose identity is %s", async (priorEmail) => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		if (priorEmail !== undefined) await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse(priorEmail) });
		await gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmailCredentialsStore.saveCredentials({ userId, refreshToken: "prior-grant", grantedScope: GMAIL_SETTINGS_SCOPE });
		const senderEmail = ForwardableSenderSchema.parse("sender@example.com");
		await fixture.gmailIntegration.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		const original = await gmailConnectionStore.findConnectionByUserId(userId);

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/integrations?error=oauth_account_changed");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBe("prior-grant");
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toEqual(original);
		expect((await fixture.gmailIntegration.gmailSenderStore.findSender({ userId, senderEmail }))?.addedToFilterAt).toBeDefined();
	});

	it("does not persist an unidentified grant when the mailbox lookup fails", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail(grantOk(), { ok: false, reason: "unavailable", status: 503 });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/integrations?error=oauth_exchange");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toBeUndefined();
	});

	it("refuses a callback whose state was not the one this browser was issued", async () => {
		const { fixture, gmailCredentialsStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await connectAndCallback(agent, { state: "forged-state" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_state");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
	});

	it("refuses a callback that carries no state cookie at all", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: "whatever" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_state");
	});

	it("reports a cancelled consent without treating it as a fault", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(CALLBACK).query({ error: "access_denied" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_denied");
	});

	it("tells the reader to re-consent when they unticked the settings permission", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "scope-not-granted" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_scope");
	});

	it("reports a grant that returned no refresh token as an exchange failure", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "no-refresh-token" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_exchange");
	});

	it("reports withheld metadata permission without replacing an existing forwarding grant", async () => {
		const { fixture, gmailCredentialsStore } = fixtureWithGmail({ ok: false, reason: "metadata-scope-not-granted" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await gmailCredentialsStore.saveCredentials({ userId, refreshToken: "existing-grant", grantedScope: GMAIL_SETTINGS_SCOPE });

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/integrations?error=oauth_metadata_scope");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBe("existing-grant");
		expect(await gmailCredentialsStore.findGrantedScopeByUserId(userId)).toBe(GMAIL_SETTINGS_SCOPE);
	});

	it("upgrades an existing settings-only connection without replacing its forwarding address", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await connectAndCallback(agent);
		const original = await gmailConnectionStore.findConnectionByUserId(userId);
		assert(original, "the original Gmail connection must exist");
		await gmailCredentialsStore.saveCredentials({ userId, refreshToken: "old-grant", grantedScope: GMAIL_SETTINGS_SCOPE });
		await gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse(" Reader@Gmail.com ") });

		await connectAndCallback(agent);

		const upgraded = await gmailConnectionStore.findConnectionByUserId(userId);
		expect(upgraded?.gatewayAddress).toBe(original.gatewayAddress);
		expect(upgraded?.forwardingConfirmedAt).toBeDefined();
		expect(await gmailCredentialsStore.findGrantedScopeByUserId(userId)).toBe(GMAIL_SCOPES);
	});

	it("reports a failed token exchange", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "exchange-failed" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_exchange");
	});

	it("redirects a reader whose access lapsed mid-grant and exchanges no code", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore, codes } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const started = await agent.post(CONNECT).send();
		const state = new URL(started.headers.location).searchParams.get("state") ?? "";
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent
			.get(CALLBACK)
			.set("Accept", "text/html")
			.query({ code: "auth-code", state });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(codes).toEqual([]);
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toBeUndefined();
	});
});

describe("GET /integrations after the Gmail callback", () => {
	it("shows Gmail waiting for step 2, not a bare connected pill", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await connectAndCallback(agent);

		const response = await agent.get("/integrations");

		expect(response.status).toBe(200);
		expect(response.text).toContain('data-test-integration-status="awaiting-confirmation"');
		expect(response.text).toContain('data-test-integration-action="finish-setup"');
	});
});
