import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { GmailAccountEmail, GmailHistoryImportJob } from "@packages/domain/gmail";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { signState } from "../../auth/oauth-state";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const CONNECT = "/newsletters/gmail/connect";
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
	const gmail = initInMemoryGmailIntegration({ grant, accountEmail, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });
	const fixture = {
		...createDefaultTestAppFixture(TEST_APP_ORIGIN),
		gmailIntegration: gmail.bundle,
	};
	return {
		fixture,
		gmail,
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

describe("POST /newsletters/gmail/connect", () => {
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
		expect([...url.searchParams.keys()].sort()).toEqual([
			"access_type",
			"client_id",
			"prompt",
			"redirect_uri",
			"response_type",
			"scope",
			"state",
		]);
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

	it("steers a reconnect to the connected mailbox", async () => {
		const { fixture, gmailConnectionStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		});

		const response = await agent.post(CONNECT).send();

		const url = new URL(response.headers.location);
		expect(url.searchParams.get("login_hint")).toBe("reader@gmail.com");
		expect([...url.searchParams.keys()].sort()).toEqual([
			"access_type",
			"client_id",
			"login_hint",
			"prompt",
			"redirect_uri",
			"response_type",
			"scope",
			"state",
		]);

		const boosted = await agent.post(CONNECT).set("HX-Request", "true").send();
		const hxRedirect = boosted.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "an htmx reconnect must carry an HX-Redirect header");
		expect(new URL(hxRedirect).searchParams.get("login_hint")).toBe("reader@gmail.com");
	});

	it("sends no mailbox hint for a connection that never recorded its address", async () => {
		const { fixture, gmailConnectionStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });

		const response = await agent.post(CONNECT).send();

		const url = new URL(response.headers.location);
		expect([...url.searchParams.keys()].sort()).toEqual([
			"access_type",
			"client_id",
			"prompt",
			"redirect_uri",
			"response_type",
			"scope",
			"state",
		]);
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
		expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
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

	it("clears a discovery reconnect requirement so the sender picker comes back after reconnecting", async () => {
		const { fixture, gmail, gmailConnectionStore, gmailCredentialsStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		});
		await gmailCredentialsStore.saveCredentials({
			userId,
			refreshToken: "prior-grant",
			grantedScope: GMAIL_SCOPES,
		});
		await gmail.bundle.gmailDiscoveryStore.startDiscovery({
			checkedMessageCount: 0,
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
			gatewayAddress,
			generation: "run-1",
			mode: "full",
			historyId: "100",
		});
		const started = await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		assert(started, "the seeded discovery must exist");
		await gmail.bundle.gmailDiscoveryStore.savePage({
			previous: started,
			senders: [],
			mode: "full",
			pageToken: "resume",
			historyId: "100",
			state: "running",
			scannedMessages: 25,
			estimatedTotalMessages: 100,
			oldestScannedAt: undefined,
		});
		await gmail.bundle.gmailDiscoveryStore.failDiscovery({
			userId,
			generation: "run-1",
			error: "Reconnect Gmail to allow Readplace to load senders.",
			requiresReconnect: true,
		});

		const blocked = await agent.get("/newsletters/gmail");
		assert(
			new JSDOM(blocked.text).window.document.querySelector("[data-test-gmail-metadata-reconnect]"),
			"a discovery permission failure must show the metadata reconnect prompt",
		);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId)).toMatchObject({
			state: "failed",
			page: 1,
			pageToken: "resume",
			requiresReconnect: false,
		});
		const page = await agent.get("/newsletters/gmail");
		const document = new JSDOM(page.text).window.document;
		assert(document.querySelector("[data-test-gmail-senders]"), "the sender picker must be rendered after reconnecting");
		const autoLoad = document.querySelector("[data-test-gmail-auto-load-senders]");
		assert(autoLoad, "the sender picker must load senders on its own once reconnected");
		expect(autoLoad.getAttribute("hx-trigger")).toBe("load");
		expect(autoLoad.getAttribute("hx-post")).toBe("/newsletters/gmail/discovery/start");
		expect(document.querySelector("[data-test-gmail-load-senders]")?.getAttribute("hx-trigger")).toBe("submit");
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("re-runs the filter reconcile after reconnecting a revoked grant", async () => {
		const { fixture, gmail, gmailConnectionStore, gmailCredentialsStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		});
		await gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		await gmailCredentialsStore.saveCredentials({
			userId,
			refreshToken: "prior-grant",
			grantedScope: GMAIL_SETTINGS_SCOPE,
		});
		const senderEmail = ForwardableSenderSchema.parse("sender@example.com");
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail });

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "reconnected" }]);
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.revokedAt).toBeUndefined();
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail }))?.addedToFilterAt).toBeDefined();
	});

	it.each(["discovery reset", "command publication"])("keeps a failed reconnect %s retryable through a fresh OAuth attempt", async (failedStep) => {
		const { fixture, gmail, gmailConnectionStore } = fixtureWithGmail();
		const publish = gmail.bundle.publishRewriteGmailFilter;
		const clear = gmail.bundle.gmailDiscoveryStore.clearRequiresReconnect;
		let recoveryFails = true;
		fixture.gmailIntegration.gmailDiscoveryStore.clearRequiresReconnect = async (input) => {
			if (recoveryFails && failedStep === "discovery reset") throw new Error("DynamoDB unavailable");
			await clear(input);
		};
		fixture.gmailIntegration.publishRewriteGmailFilter = async (detail) => {
			if (recoveryFails && failedStep === "command publication") throw new Error("EventBridge unavailable");
			await publish(detail);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") });
		await gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const senderEmail = ForwardableSenderSchema.parse("sender@example.com");
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail });

		const failed = await connectAndCallback(agent);

		expect(failed.status).toBe(500);
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.revokedReason).toBe("invalid-grant");
		expect(gmail.rewriteRequests).toEqual([]);

		recoveryFails = false;
		const recovered = await connectAndCallback(agent);

		expect(recovered.status).toBe(303);
		expect(recovered.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "reconnected" }]);
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.revokedAt).toBeUndefined();
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail }))?.addedToFilterAt).toBeDefined();
	});

	it("does not mark a scope upgrade revoked when resetting discovery fails", async () => {
		const { fixture, gmail, gmailConnectionStore } = fixtureWithGmail();
		fixture.gmailIntegration.gmailDiscoveryStore.clearRequiresReconnect = async () => {
			throw new Error("DynamoDB unavailable");
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") });

		const failed = await connectAndCallback(agent);

		expect(failed.status).toBe(500);
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.revokedAt).toBeUndefined();
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("does not revoke a replacement connection when reconnect publication fails", async () => {
		const { fixture, gmailConnectionStore } = fixtureWithGmail();
		fixture.gmailIntegration.publishRewriteGmailFilter = async ({ userId }) => {
			await gmailConnectionStore.deleteConnection(userId);
			const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
			await gmailConnectionStore.createConnection({ userId, gatewayAddress });
			await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("replacement@gmail.com") });
			throw new Error("EventBridge unavailable");
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") });
		await gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });

		const failed = await connectAndCallback(agent);

		expect(failed.status).toBe(500);
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toMatchObject({
			accountEmail: "replacement@gmail.com",
			revokedAt: undefined,
		});
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

		expect(response.headers.location).toBe("/newsletters?error=oauth_account_changed");
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

		expect(response.headers.location).toBe("/newsletters?error=oauth_exchange");
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
		expect(response.headers.location).toBe("/newsletters?error=oauth_state");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
	});

	it("refuses a callback that returns after the consent state expired", async () => {
		const { fixture, gmailCredentialsStore } = fixtureWithGmail();
		let offsetMs = 0;
		fixture.shared.now = () => new Date(Date.now() + offsetMs);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const started = await agent.post(CONNECT).send();
		offsetMs = 5 * 60 * 1000 + 1000;

		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: new URL(started.headers.location).searchParams.get("state") });

		expect(response.headers.location).toBe("/newsletters?error=oauth_state");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
	});

	it.each([
		["a tampered signature", "tampered.signature"],
		["a payload signed before connect intents existed", signState({ payload: JSON.stringify({ nonce: "n", createdAt: Date.now() }), secret: "test-state-secret" })],
	])("refuses a callback whose state cookie carries %s", async (_label, state) => {
		const { fixture, gmailCredentialsStore } = fixtureWithGmail();
		const harness = useApp(fixture);
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const login = await request(harness.server).post("/login").set("User-Agent", BROWSER_USER_AGENT).type("form").send({ email: "test@example.com", password: "password123" });
		const session = login.headers["set-cookie"];
		assert(Array.isArray(session), "signing in must set the session cookie");
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await request(harness.server)
			.get(CALLBACK)
			.query({ code: "auth-code", state })
			.set("User-Agent", BROWSER_USER_AGENT)
			.set("Cookie", [...session.map((cookie) => cookie.split(";")[0]), `hutch_gmail_state=${encodeURIComponent(state)}`].join("; "));

		expect(response.headers.location).toBe("/newsletters?error=oauth_state");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
	});

	it("refuses a callback that carries no state cookie at all", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: "whatever" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_state");
	});

	it("reports a cancelled consent without treating it as a fault", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(CALLBACK).query({ error: "access_denied" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_denied");
	});

	it("tells the reader to re-consent when they unticked the settings permission", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "scope-not-granted" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_scope");
	});

	it("reports a grant that returned no refresh token as an exchange failure", async () => {
		const { fixture } = fixtureWithGmail({ ok: false, reason: "no-refresh-token" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_exchange");
	});

	it("tells a first-time reader to connect again with header access ticked, writing nothing", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail({ ok: false, reason: "metadata-scope-not-granted" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/newsletters?error=oauth_metadata_scope_first_connect");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toBeUndefined();
	});

	it("reports withheld metadata permission without replacing an existing forwarding grant", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail({ ok: false, reason: "metadata-scope-not-granted" });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailCredentialsStore.saveCredentials({ userId, refreshToken: "existing-grant", grantedScope: GMAIL_SETTINGS_SCOPE });
		const original = await gmailConnectionStore.findConnectionByUserId(userId);

		const response = await connectAndCallback(agent);

		expect(response.headers.location).toBe("/newsletters?error=oauth_metadata_scope");
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBe("existing-grant");
		expect(await gmailCredentialsStore.findGrantedScopeByUserId(userId)).toBe(GMAIL_SETTINGS_SCOPE);
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toEqual(original);
	});

	it("upgrades an existing settings-only connection without replacing its forwarding address", async () => {
		const { fixture, gmail, gmailCredentialsStore, gmailConnectionStore } = fixtureWithGmail();
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
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("reports a failed token exchange and logs Google's error detail", async () => {
		const { fixture } = fixtureWithGmail({
			ok: false,
			reason: "exchange-failed",
			status: 400,
			error: "invalid_grant",
			errorDescription: "Malformed auth code.",
		});
		const errorMessages: string[] = [];
		fixture.shared.logError = (msg) => { errorMessages.push(msg); };
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await connectAndCallback(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_exchange");
		expect(errorMessages).toContain(
			'[gmail-connect] grant unusable: {"reason":"exchange-failed","status":400,"error":"invalid_grant","errorDescription":"Malformed auth code."}',
		);
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

	it("sends a signed-out callback to sign in and back to the newsletters page", async () => {
		const { fixture, codes } = fixtureWithGmail();
		const harness = useApp(fixture);

		const response = await request(harness.server)
			.get(CALLBACK)
			.query({ code: "auth-code", state: "whatever" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/login?return=%2Fnewsletters%3Ferror%3Doauth_signed_out",
		);
		expect(codes).toEqual([]);
	});

	it("drops a grant whose session ended between consent and callback", async () => {
		const { fixture, gmailCredentialsStore, gmailConnectionStore, codes } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const started = await agent.post(CONNECT).send();
		const state = new URL(started.headers.location).searchParams.get("state") ?? "";
		await harness.auth.destroyUserSessions(userId);

		const response = await agent.get(CALLBACK).query({ code: "auth-code", state });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/login?return=%2Fnewsletters%3Ferror%3Doauth_signed_out",
		);
		expect(codes).toEqual([]);
		expect(await gmailCredentialsStore.findRefreshTokenByUserId(userId)).toBeUndefined();
		expect(await gmailConnectionStore.findConnectionByUserId(userId)).toBeUndefined();
	});

	it("lands the reader on the integrations page with the signed-out notice after signing in", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const signedOut = await request(harness.server)
			.get(CALLBACK)
			.query({ code: "auth-code", state: "whatever" });
		const loginPath = signedOut.headers.location;

		const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
		const signedIn = await agent
			.post(loginPath)
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		expect(signedIn.status).toBe(303);
		expect(signedIn.headers.location).toBe("/newsletters?error=oauth_signed_out");

		const index = await agent.get(signedIn.headers.location);
		const alert = new JSDOM(index.text).window.document.querySelector(
			'[data-test-alert-variant="error"]',
		);
		assert(alert, "the integrations index must render the signed-out alert after signing in");
		expect(alert.getAttribute("data-test-alert")).toBe("oauth_signed_out");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.classList.contains("alert--visible")).toBe(true);
	});
});

describe("GET /newsletters after the Gmail callback", () => {
	it("shows Gmail waiting for step 2, not a bare connected pill", async () => {
		const { fixture } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await connectAndCallback(agent);

		const response = await agent.get("/newsletters");

		expect(response.status).toBe(200);
		expect(response.text).toContain('data-test-integration-status="awaiting-confirmation"');
		expect(response.text).toContain('data-test-integration-action="finish-setup"');
	});
});

describe("Gmail read permission for an import", () => {
	const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
	const READER = GmailAccountEmailSchema.parse("reader@gmail.com");

	async function awaitingImport(
		grantedScope: string,
		job: Pick<GmailHistoryImportJob, "state" | "failureReason"> & { failed?: number; destination?: "mapped" | "previous" } = { state: "awaiting-permission", failureReason: undefined },
	) {
		const { fixture, gmail, gmailConnectionStore } = fixtureWithGmail({
			ok: true,
			grant: { refreshToken: "refresh-value", accessToken: "access-value", grantedScope },
		});
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
		await gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmailConnectionStore.recordAccountEmail({ userId, accountEmail: READER });
		await gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "prior-grant", grantedScope: GMAIL_SCOPES });
		await gmail.bundle.gmailDiscoveryStore.startDiscovery({ checkedMessageCount: 0, userId, accountEmail: READER, gatewayAddress, generation: "run-1", mode: "full", historyId: "100" });
		const destination = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		const previous = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: ReadlistSlugSchema.parse("tech") });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: TLDR, mappedAddress: destination.address });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		const jobId = gmail.bundle.newGmailHistoryImportJobId();
		await gmail.bundle.gmailHistoryImportStore.createJob({
			userId,
			jobId,
			senderEmail: TLDR,
			destinationAddress: job.destination === "previous" ? previous.address : destination.address,
			connection: { gatewayAddress, accountEmail: READER },
			window: undefined,
			generation: "waiting",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: job.state,
			counts: { listed: job.failed ?? 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: job.failed ?? 0, cancelled: 0 },
			failureReason: job.failureReason,
			cancelReason: undefined,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			completedAt: undefined,
		});
		const askForPermission = async (state: Record<string, string> = {}) => {
			const started = await agent.post(CONNECT).type("form").send({ ...state, intent: "import", sender: TLDR });
			return new URL(started.headers.location);
		};
		const findJob = () => gmail.bundle.gmailHistoryImportStore.findJob({ userId, jobId });
		return { agent, gmail, gmailConnectionStore, userId, jobId, askForPermission, findJob };
	}

	it("asks Google for read access on top of the scopes already granted", async () => {
		const { askForPermission } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		const url = await askForPermission();
		expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
		expect(url.searchParams.get("include_granted_scopes")).toBe("true");
		expect(url.searchParams.get("login_hint")).toBe("reader@gmail.com");
	});

	it("resumes waiting imports without rewriting the connection or its discovery", async () => {
		const { agent, gmail, gmailConnectionStore, userId, jobId, askForPermission, findJob } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		const before = await gmailConnectionStore.findConnectionByUserId(userId);
		const url = await askForPermission();
		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_started");
		const job = await findJob();
		expect(job?.state).toBe("queued");
		expect(gmail.importStartRequests).toEqual([{ userId, jobId, generation: job?.generation }]);
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.connectedAt).toBe(before?.connectedAt);
		expect((await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId))?.generation).toBe("run-1");
		expect(await gmail.bundle.gmailCredentialsStore.findGrantedScopeByUserId(userId)).toBe(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it.each([
		["failed after losing permission", { state: "failed", failureReason: "permission-revoked" }],
		["finished with failed messages", { state: "complete", failureReason: undefined, failed: 1 }],
	] as const)("restarts the newsletter's import that %s once Google grants read access", async (_label, job) => {
		const { agent, gmail, userId, jobId, askForPermission, findJob } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`, job);
		const url = await askForPermission();
		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_started");
		const restarted = await findJob();
		expect(restarted?.state).toBe("queued");
		expect(gmail.importStartRequests).toEqual([{ userId, jobId, generation: restarted?.generation }]);
	});

	it("says permission was granted, restarting nothing, when the failed import went to the newsletter's previous readlist", async () => {
		const { agent, gmail, askForPermission, findJob } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`, {
			state: "failed",
			failureReason: "permission-revoked",
			destination: "previous",
		});
		const url = await askForPermission();
		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_permission_granted");
		expect((await findJob())?.state).toBe("failed");
		expect(gmail.importStartRequests).toEqual([]);
		const page = new JSDOM((await agent.get(response.headers.location)).text).window.document;
		expect(page.querySelector('[data-test-alert="import_permission_granted"]')?.textContent).toBe(
			"Readplace can now read your Gmail messages. Start the import from the newsletter below.",
		);
	});

	it("returns the reader to the picker state they left from, whatever Google answers", async () => {
		const pickerState = { search: "dan", advanced: "1", readlist: "default", edit: "1", discovery_after: "none" };
		const back = "search=dan&advanced=1&readlist=default&discovery_after=none";
		const granted = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		const grantedUrl = await granted.askForPermission(pickerState);
		expect((await granted.agent.get(CALLBACK).query({ code: "auth-code", state: grantedUrl.searchParams.get("state") })).headers.location)
			.toBe(`/newsletters/gmail?notice=import_started&${back}`);
		const withheld = await awaitingImport(GMAIL_SCOPES);
		const withheldUrl = await withheld.askForPermission(pickerState);
		expect((await withheld.agent.get(CALLBACK).query({ code: "auth-code", state: withheldUrl.searchParams.get("state") })).headers.location)
			.toBe(`/newsletters/gmail?notice=import_permission_refused&${back}`);
		await withheld.askForPermission(pickerState);
		expect((await withheld.agent.get(CALLBACK).query({ error: "access_denied" })).headers.location)
			.toBe(`/newsletters/gmail?notice=import_permission_refused&${back}`);
	});

	it("keeps the import waiting when Google grants everything but read access", async () => {
		const { agent, gmail, askForPermission, findJob } = await awaitingImport(GMAIL_SCOPES);
		const url = await askForPermission();
		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_permission_refused");
		expect((await findJob())?.state).toBe("awaiting-permission");
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("tells the reader the import is waiting when they refuse on Google's screen", async () => {
		const { agent, gmail, askForPermission, findJob } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		await askForPermission();
		const response = await agent.get(CALLBACK).query({ error: "access_denied" });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_permission_refused");
		expect((await findJob())?.state).toBe("awaiting-permission");
		expect(gmail.exchangedCodes).toEqual([]);
	});

	it("reconnects a revoked grant while resuming the import", async () => {
		const { agent, gmail, gmailConnectionStore, userId, askForPermission, findJob } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		await gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const url = await askForPermission();
		const response = await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect(response.headers.location).toBe("/newsletters/gmail?notice=import_started");
		expect((await gmailConnectionStore.findConnectionByUserId(userId))?.revokedAt).toBeUndefined();
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "reconnected" }]);
		expect((await findJob())?.state).toBe("queued");
	});

	it("clears a discovery reconnect requirement while resuming the import", async () => {
		const { agent, gmail, userId, askForPermission } = await awaitingImport(`${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`);
		await gmail.bundle.gmailDiscoveryStore.failDiscovery({ userId, generation: "run-1", error: "Reconnect", requiresReconnect: true });
		expect((await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId))?.requiresReconnect).toBe(true);
		const url = await askForPermission();
		await agent.get(CALLBACK).query({ code: "auth-code", state: url.searchParams.get("state") });
		expect((await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId))?.requiresReconnect).toBe(false);
	});
});
