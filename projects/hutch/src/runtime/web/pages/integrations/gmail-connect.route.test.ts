import assert from "node:assert/strict";
import request from "supertest";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const CONNECT = "/integrations/gmail/connect";
const CALLBACK = "/integrations/gmail/callback";

function grantOk(): GmailGrantResult {
	return {
		ok: true,
		grant: {
			refreshToken: "refresh-value",
			accessToken: "access-value",
			grantedScope: GMAIL_SETTINGS_SCOPE,
		},
	};
}

function fixtureWithGmail(grant: GmailGrantResult = grantOk()) {
	const gmail = initInMemoryGmailIntegration({ grant });
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
	it("redirects to Google asking only for the settings scope, offline and with forced consent", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(CONNECT).send();

		expect(response.status).toBe(303);
		const url = new URL(response.headers.location);
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(url.searchParams.get("scope")).toBe(GMAIL_SETTINGS_SCOPE);
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("test-client-id");
		expect(url.searchParams.get("redirect_uri")).toBe(`${TEST_APP_ORIGIN}${CALLBACK}`);
	});

	it("requires a signed-in reader", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);

		const response = await request(harness.server).post(CONNECT).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("GET /integrations/gmail/callback", () => {
	it("stores the refresh token and reports the connection", async () => {
		const { fixture, gmailCredentialsStore, codes } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=connected");
		expect(codes).toEqual(["auth-code"]);
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBe("refresh-value");
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

	it("reports a failed token exchange", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "exchange-failed" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?error=oauth_exchange");
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
