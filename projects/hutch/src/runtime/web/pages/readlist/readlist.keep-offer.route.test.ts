import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Token } from "@node-oauth/oauth2-server";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const SIREN = "application/vnd.siren+json";

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

async function loginUser(harness: Harness, email: string) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

async function crossActivationThreshold(harness: Harness, userId: UserId) {
	const at = new Date();
	await harness.auth.countEarlyIntentionalSave({ userId, at });
	await harness.auth.countEarlyIntentionalSave({ userId, at });
	await harness.auth.markActivationThresholdReached({ userId, at });
}

async function eligibleReader(harness: Harness, email: string) {
	const reader = await loginUser(harness, email);
	await harness.subscriptionProviders.upsertTrialing({
		userId: reader.userId,
		trialEndsAt: new Date(Date.now() + 20 * ONE_DAY_MS).toISOString(),
	});
	await crossActivationThreshold(harness, reader.userId);
	return reader;
}

async function sirenAccessToken(harness: Harness, userId: UserId): Promise<string> {
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the extension's oauth client must exist");
	const token: Token = {
		accessToken: "test-access-token-keep-offer",
		accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
		client,
		user: { id: userId },
	};
	const saved = await harness.oauthModel.saveToken(token, client, { id: userId });
	assert(saved, "the access token must be saved");
	return saved.accessToken;
}

function keepOfferAside(html: string): Element {
	const aside = new JSDOM(html).window.document.querySelector("[data-test-keep-offer]");
	assert(aside, "the keep offer aside must always be rendered");
	return aside;
}

function keepOfferShownEvents(harness: Harness) {
	return harness.analytics.events.filter((event) => event.event === "keep_offer_shown");
}

describe("Keep Readplace panel on the queue", () => {
	it("shows the panel first in the side column to a trial reader who crossed the threshold, and records one impression", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await eligibleReader(harness, "keep-shown@example.com");

		const response = await agent.get("/queue");

		const aside = keepOfferAside(response.text);
		expect(aside.classList.contains("readlist-keep-offer--shown")).toBe(true);
		expect(aside.parentElement?.classList.contains("readlist__side")).toBe(true);
		expect(aside.previousElementSibling).toBeNull();
		expect(aside.querySelector("h2")?.textContent).toBe("You've kept 2 articles this week.");
		expect(keepOfferShownEvents(harness)).toEqual([
			expect.objectContaining({
				event: "keep_offer_shown",
				user_id: userId,
				surface: "readlist-panel",
				trial_day: 1,
			}),
		]);
	});

	it("records one impression per shown render", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await eligibleReader(harness, "keep-twice@example.com");

		await agent.get("/queue");
		await agent.get("/queue");

		expect(keepOfferShownEvents(harness)).toHaveLength(2);
	});

	it("keeps the panel hidden and records nothing for a trial reader who has not crossed the threshold", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "keep-no-crossing@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 20 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");

		expect(keepOfferAside(response.text).classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});

	it("keeps the panel hidden for a founding member who crossed the threshold", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "keep-founding@example.com");
		await crossActivationThreshold(harness, userId);

		const response = await agent.get("/queue");

		expect(keepOfferAside(response.text).classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});

	it("keeps the panel hidden for a paying reader who crossed the threshold", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "keep-paid@example.com");
		await crossActivationThreshold(harness, userId);
		await harness.subscriptionProviders.upsertActive({
			userId,
			customerId: "cus_keep_paid",
			subscriptionId: "sub_keep_paid",
		});

		const response = await agent.get("/queue");

		expect(keepOfferAside(response.text).classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});

	it("keeps the panel hidden for a reader whose cancellation is scheduled", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "keep-cancelling@example.com");
		await crossActivationThreshold(harness, userId);
		const effectiveAt = new Date(Date.now() + 20 * ONE_DAY_MS).toISOString();
		await harness.subscriptionProviders.upsertActive({
			userId,
			customerId: "cus_keep_cancelling",
			subscriptionId: "sub_keep_cancelling",
		});
		await harness.subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: effectiveAt,
		});

		const response = await agent.get("/queue");

		expect(keepOfferAside(response.text).classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});

	it("dismisses the panel for the account on Not now and redirects back to the queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await eligibleReader(harness, "keep-dismiss@example.com");

		const dismissed = await agent.post("/queue/keep-offer/dismiss");

		expect(dismissed.status).toBe(303);
		expect(dismissed.headers.location).toBe("/queue");
		const response = await agent.get("/queue");
		expect(keepOfferAside(response.text).classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});

	it("leaves the Siren listing untouched, so native apps and MCP never see the offer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId } = await eligibleReader(harness, "keep-siren@example.com");
		const accessToken = await sirenAccessToken(harness, userId);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN);
		expect(response.text).not.toContain("keep-offer");
		expect(keepOfferShownEvents(harness)).toEqual([]);
	});
});
