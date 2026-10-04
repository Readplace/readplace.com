import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, DISMISS_COOKIE_NAME, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";
import { GMAIL_ONBOARDING_VERSION, ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";

const useApp = useTestServer();
const DAY = 86_400_000;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const GMAIL_STEP = '[data-test-onboarding-step="connect-gmail"]';
const DISMISS = "/queue/onboarding/gmail/dismiss";

function fixtureWithGmail(grant: GmailGrantResult = {
	ok: true,
	grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES },
}) {
	const gmail = initInMemoryGmailIntegration({
		grant,
		addresses: initInMemoryInboxAddress({ now: () => new Date() }),
		accountEmail: { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
	});
	return { ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle };
}

async function userIdOf(harness: TestAppHarness) {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user);
	return user.userId;
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function gmailStep(html: string): Element {
	const step = documentOf(html).querySelector(GMAIL_STEP);
	assert(step, "eligible readers must see Connect your Gmail");
	return step;
}

async function oauth(agent: Awaited<ReturnType<typeof loginAgent>>) {
	const start = await agent.post("/newsletters/gmail/connect");
	const state = new URL(start.headers.location).searchParams.get("state");
	return agent.get("/integrations/gmail/callback").query({ code: "auth-code", state });
}

describe("Readlist onboarding — Connect your Gmail", () => {
	it.each([CHROME, IPHONE, SAFARI, ANDROID, "unrecognised device"])("offers Gmail on %s without a feature flag", async (ua) => {
		const harness = useApp(fixtureWithGmail());
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/queue").set("User-Agent", ua);
		const step = gmailStep(response.text);
		expect(step.textContent).toContain("Connect your Gmail");
		expect(step.textContent).toContain("Connect Gmail to choose which newsletters arrive in Readplace.");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("false");
		expect(step.querySelector('[data-test-onboarding-action="connect-gmail"]')?.closest("form")?.getAttribute("action")).toBe("/newsletters");
		expect(step.querySelector('[data-test-onboarding-action="gmail-dismiss"]')?.textContent).toBe("I don't want to do this");
	});

	it.each(["active", "pending_cancellation"])("offers Gmail to %s paid accounts", async (status) => {
		const harness = useApp(fixtureWithGmail());
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_paid", customerId: "cus_paid" });
		if (status === "pending_cancellation") {
			await harness.subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: new Date(Date.now() + DAY).toISOString() });
		}
		gmailStep((await agent.get("/queue").set("User-Agent", CHROME)).text);
	});

	it.each(["trial", "trial_pending_cancellation", "expired_trial", "cancelled", "expired_paid"])("hides Gmail and rejects dismissal for %s accounts", async (status) => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		if (status === "expired_paid") {
			await harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_paid", customerId: "cus_paid" });
		} else {
			await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + (status === "expired_trial" ? -DAY : DAY)).toISOString() });
		}
		if (status.includes("pending") || status === "expired_paid") {
			await harness.subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: new Date(Date.now() + (status === "expired_paid" ? -DAY : DAY)).toISOString() });
		}
		if (status === "cancelled") await harness.subscriptionProviders.markCancelledByUserId({ userId });
		const response = await agent.get("/queue").set("User-Agent", CHROME);
		expect(documentOf(response.text).querySelector(GMAIL_STEP)).toBeNull();
		const rejected = await agent.post(DISMISS);
		expect(rejected.status).toBe(303);
		expect(rejected.headers.location).toBe("/newsletters");
	});

	it("omits Gmail and its dismiss endpoint when Gmail is not configured", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		expect(documentOf((await agent.get("/queue").set("User-Agent", CHROME)).text).querySelector(GMAIL_STEP)).toBeNull();
		expect((await agent.post(DISMISS)).status).toBe(404);
	});

	it("requires authentication", async () => {
		const harness = useApp(fixtureWithGmail());
		const response = await request(harness.server).post(DISMISS);
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
		expect(documentOf((await request(harness.server).get("/queue")).text).querySelector(GMAIL_STEP)).toBeNull();
	});

	it("does not offer Gmail or allow dismissal on a locked account", async () => {
		const fixture = fixtureWithGmail();
		fixture.shared.now = () => new Date(Date.now() + 8 * DAY);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		expect(documentOf((await agent.get("/queue").set("User-Agent", CHROME)).text).querySelector(GMAIL_STEP)).toBeNull();
		expect(documentOf((await agent.post(DISMISS).set("Accept", "text/html")).text).querySelector("h1")?.textContent).toBe("Your account is locked");
	});

	it("overrides a previous whole-onboarding dismissal while Gmail is outstanding", async () => {
		const harness = useApp(fixtureWithGmail());
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/queue").set("User-Agent", CHROME).set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}; ${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`);
		gmailStep(response.text);
		expect(documentOf(response.text).querySelector("[data-test-onboarding]")?.classList.contains("setup-guide--visible")).toBe(true);
	});

	it("keeps Gmail independent of the unsupported-device notice's dismissal", async () => {
		const harness = useApp(fixtureWithGmail());
		const agent = await loginAgent(harness.server, harness.auth);
		const before = await agent.get("/queue").set("User-Agent", SAFARI);
		gmailStep(before.text);
		expect(documentOf(before.text).querySelector("[data-test-onboarding-no-client]")).not.toBeNull();
		await agent.post("/queue/dismiss-onboarding").set("User-Agent", SAFARI);
		const after = await agent.get("/queue").set("User-Agent", SAFARI);
		gmailStep(after.text);
		expect(documentOf(after.text).querySelector("[data-test-onboarding-no-client]")?.classList.contains("setup-guide--hidden")).toBe(true);
	});

	it("completes immediately after Google authorization, before forwarding or sender selection", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.get("/queue").set("User-Agent", CHROME);
		expect((await oauth(agent)).status).toBe(303);
		const connection = await fixture.gmailIntegration.gmailConnectionStore.findConnectionByUserId(await userIdOf(harness));
		expect(connection?.forwardingConfirmedAt).toBeUndefined();
		expect(gmailStep((await agent.get("/queue").set("User-Agent", CHROME)).text).getAttribute("data-test-onboarding-complete")).toBe("true");
		expect(documentOf((await agent.get("/queue").set("User-Agent", SAFARI)).text).querySelector(GMAIL_STEP)).toBeNull();
	});

	it("leaves the task outstanding after failed authorization", async () => {
		const harness = useApp(fixtureWithGmail({ ok: false, reason: "exchange-failed", status: 503, error: undefined, errorDescription: undefined }));
		const agent = await loginAgent(harness.server, harness.auth);
		await oauth(agent);
		expect(gmailStep((await agent.get("/queue").set("User-Agent", CHROME)).text).getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("permanently dismisses Gmail across browser sessions and keeps the readlist state", async () => {
		const harness = useApp(fixtureWithGmail());
		const agent = await loginAgent(harness.server, harness.auth);
		const redirect = await agent.post(`${DISMISS}?queue=tech&tab=done&order=asc&page=2`);
		expect(redirect.status).toBe(303);
		expect(redirect.headers.location).toBe("/queue?queue=tech&tab=done&order=asc&page=2");
		expect((await agent.post(DISMISS)).status).toBe(303);
		const browser = request.agent(harness.server);
		await browser.post("/login").type("form").send({ email: "test@example.com", password: "password123" });
		for (const ua of [CHROME, IPHONE, SAFARI]) {
			expect(documentOf((await browser.get("/queue").set("User-Agent", ua)).text).querySelector(GMAIL_STEP)).toBeNull();
		}
	});

	it("reveals Gmail on upgrade, hides it on access loss, and retains permanent dismissal after re-upgrade", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + DAY).toISOString() });
		const queue = () => agent.get("/queue").set("User-Agent", CHROME);
		expect(documentOf((await queue()).text).querySelector(GMAIL_STEP)).toBeNull();
		const upgrade = () => harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_paid", customerId: "cus_paid" });
		await upgrade();
		gmailStep((await queue()).text);
		await harness.subscriptionProviders.markCancelledByUserId({ userId });
		expect(documentOf((await queue()).text).querySelector(GMAIL_STEP)).toBeNull();
		await upgrade();
		gmailStep((await queue()).text);
		await agent.post(DISMISS);
		await harness.subscriptionProviders.markCancelledByUserId({ userId });
		await queue();
		await upgrade();
		expect(documentOf((await queue()).text).querySelector(GMAIL_STEP)).toBeNull();
	});

	it.each(["disconnecting", "disconnected", "revoked"])("reopens Gmail after %s despite a current whole-onboarding dismissal", async (state) => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await fixture.onboardingSignals.recordInboxArticleQueued({ userId });
		await fixture.onboardingSignals.recordNextReadMinimumReached({ userId });
		const cookies = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
		await agent.get("/queue").set("User-Agent", CHROME).set("Cookie", cookies);
		await oauth(agent);
		const complete = await agent.get("/queue").set("User-Agent", CHROME).set("Cookie", cookies);
		expect(documentOf(complete.text).querySelector("[data-test-onboarding]")?.classList.contains("setup-guide--complete")).toBe(true);
		const dismissed = await agent.post("/queue/dismiss-onboarding").set("User-Agent", CHROME);
		expect(dismissed.headers["set-cookie"]?.join(";")).toContain(GMAIL_ONBOARDING_VERSION);
		const store = fixture.gmailIntegration.gmailConnectionStore;
		if (state === "revoked") await store.markRevoked({ userId, reason: "invalid-grant" });
		else {
			await agent.post("/newsletters/gmail/disconnect");
			if (state === "disconnected") await store.deleteConnection(userId);
		}
		const reopened = await agent.get("/queue").set("User-Agent", CHROME).set("Cookie", `${cookies}; ${DISMISS_COOKIE_NAME}=${GMAIL_ONBOARDING_VERSION}`);
		expect(gmailStep(reopened.text).getAttribute("data-test-onboarding-current")).toBe("true");
		expect(documentOf(reopened.text).querySelector("[data-test-onboarding]")?.classList.contains("setup-guide--visible")).toBe(true);
	});

	it.each(["awaiting-confirmation", "confirm-failed", "ready-to-filter", "filter-failed", "filtering"])("counts %s as authorized without further setup", async (state) => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		const store = fixture.gmailIntegration.gmailConnectionStore;
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await store.createConnection({ userId, gatewayAddress });
		if (state === "confirm-failed") await store.recordConfirmError({ userId, error: { reason: "not-confirmed", at: new Date().toISOString() } });
		if (["ready-to-filter", "filter-failed", "filtering"].includes(state)) await store.markForwardingConfirmed({ userId });
		if (state === "filter-failed") await store.recordFilterError({ userId, error: { code: "rejected", message: "failed", at: new Date().toISOString() } });
		if (state === "filtering") await store.recordFilter({ userId, filterCount: 1, filterSenderCount: 1 });
		expect(gmailStep((await agent.get("/queue").set("User-Agent", CHROME)).text).getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("keeps permanent dismissal after Gmail is connected, revoked and disconnected", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await agent.post(DISMISS);
		await oauth(agent);
		await fixture.gmailIntegration.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		expect(documentOf((await agent.get("/queue").set("User-Agent", CHROME)).text).querySelector(GMAIL_STEP)).toBeNull();
		await fixture.gmailIntegration.gmailConnectionStore.deleteConnection(userId);
		expect(documentOf((await agent.get("/queue").set("User-Agent", CHROME)).text).querySelector(GMAIL_STEP)).toBeNull();
	});

	it("persists before redirecting, preserves the first dismissal instant, and isolates accounts", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await agent.post(DISMISS);
		const first = (await fixture.onboardingSignals.getOnboardingSignals({ userId })).gmailStepDismissedAt;
		expect(first).toBeInstanceOf(Date);
		await agent.post(DISMISS);
		expect((await fixture.onboardingSignals.getOnboardingSignals({ userId })).gmailStepDismissedAt).toEqual(first);
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		const browser = request.agent(harness.server);
		await browser.post("/login").type("form").send({ email: "other@example.com", password: "password123" });
		gmailStep((await browser.get("/queue").set("User-Agent", CHROME)).text);
		expect((await fixture.onboardingSignals.getOnboardingSignals({ userId: other.userId })).gmailStepDismissedAt).toBeUndefined();
	});

	it("returns the existing error response and leaves Gmail outstanding when dismissal persistence fails", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp({ ...fixture, onboardingSignals: { ...fixture.onboardingSignals, recordGmailStepDismissed: async () => { throw new Error("dynamo down"); } } });
		const agent = await loginAgent(harness.server, harness.auth);
		const failed = await agent.post(DISMISS);
		expect(failed.status).toBe(500);
		expect(failed.headers.location).toBeUndefined();
		expect((await fixture.onboardingSignals.getOnboardingSignals({ userId: await userIdOf(harness) })).gmailStepDismissedAt).toBeUndefined();
		gmailStep((await agent.get("/queue").set("User-Agent", CHROME)).text);
	});

	it("uses the Gmail access middleware for htmx dismissal attempts by trials", async () => {
		const fixture = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await userIdOf(harness);
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + DAY).toISOString() });
		const rejected = await agent.post(DISMISS).set("HX-Request", "true");
		expect(rejected.status).toBe(200);
		expect(rejected.headers["hx-redirect"]).toBe("/newsletters");
		expect((await fixture.onboardingSignals.getOnboardingSignals({ userId })).gmailStepDismissedAt).toBeUndefined();
	});
});
