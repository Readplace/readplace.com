import assert from "node:assert/strict";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { ANALYTICS_EVENTS } from "../../../observability/events";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();

async function trialist(harness: TestAppHarness) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in reader must exist");
	await harness.subscriptionProviders.upsertTrialing({
		userId: user.userId,
		trialEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
	});
	return { agent, userId: user.userId };
}

async function bearerFor(harness: TestAppHarness, userId: UserId): Promise<string> {
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the oauth client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "activation-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: "activation-refresh-token",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
			client,
			user: { id: userId },
		},
		client,
		{ id: userId },
	);
	assert(token, "the token must be saved");
	return token.accessToken;
}

describe("activation_threshold_reached on the save routes", () => {
	it("records one event, on the second POST /queue, for a first save ticked into a readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId } = await trialist(harness);
		const work = ReadlistSlugSchema.parse("work");
		await harness.articleStore.createReadlistDefinition({ userId, slug: work, label: "Work", createdAt: new Date() });
		const accessToken = await bearerFor(harness, userId);
		const saveThroughApi = (body: { url: string; readlists?: string[] }) =>
			request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`)
				.send(body);

		const first = await saveThroughApi({
			url: "https://example.com/ticked-first",
			readlists: [`/queue?readlist=${work}`],
		});
		expect(first.status).toBe(201);
		expect(JSON.stringify(first.body)).toContain("Saved to 'Work'");
		expect(harness.funnelEvents.events).toEqual([]);

		await saveThroughApi({ url: "https://example.com/ticked-second" });

		expect(harness.funnelEvents.events).toHaveLength(1);
		expect(harness.funnelEvents.events[0]).toMatchObject({
			event: ANALYTICS_EVENTS.activationThresholdReached,
			user_id: userId,
			oauth_client_id: null,
			hours_since_signup: 0,
		});
	});

	it("counts the signup autosave's POST /queue/save, so the second new link reaches the threshold", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await trialist(harness);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/autosaved" });
		expect(harness.funnelEvents.events).toEqual([]);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/second-link" });

		expect(harness.funnelEvents.events).toHaveLength(1);
		expect(harness.funnelEvents.events[0]).toMatchObject({ user_id: userId });
	});

	it("does not count a re-save of the same link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await trialist(harness);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/same" });
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/same" });

		expect(harness.funnelEvents.events).toEqual([]);
	});
});
