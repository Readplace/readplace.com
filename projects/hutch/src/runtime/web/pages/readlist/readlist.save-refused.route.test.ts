import assert from "node:assert/strict";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();

async function lapsedReader(harness: TestAppHarness) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in reader must exist");
	await harness.subscriptionProviders.upsertTrialing({
		userId: user.userId,
		trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
	});
	return { agent, userId: user.userId };
}

async function bearerFor(harness: TestAppHarness, userId: UserId): Promise<string> {
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the oauth client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "save-refused-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: "save-refused-refresh-token",
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

function refusalsIn(harness: TestAppHarness) {
	return harness.analytics.events.filter((e) => e.event === "save_refused");
}

describe("save_refused on the gated save routes", () => {
	it.each(["/queue", "/queue/save", "/queue/save-content"])("records a web POST %s at the gate's 303", async (route) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await lapsedReader(harness);

		const response = await agent.post(route).set("Accept", "text/html").type("form").send({ url: "https://example.com/a" });

		expect(response.status).toBe(303);
		expect(refusalsIn(harness)).toEqual([
			expect.objectContaining({ path: route, status: 303, code: "no_write_access", user_id: userId }),
		]);
	});

	it.each(["/queue", "/queue/save-content"])("records an extension POST %s at the gate's 402", async (route) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId } = await lapsedReader(harness);
		const accessToken = await bearerFor(harness, userId);

		const response = await request(harness.server)
			.post(route)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/a" });

		expect(response.status).toBe(402);
		expect(refusalsIn(harness)).toEqual([
			expect.objectContaining({
				path: route,
				status: 402,
				code: "no_write_access",
				client: "firefox_extension",
				user_id: userId,
			}),
		]);
	});

	it("records an inactive POST /queue/:id/issue-links under the route's pattern", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await lapsedReader(harness);

		const response = await agent
			.post(`/queue/${"a".repeat(32)}/issue-links`)
			.set("Accept", "text/html")
			.type("form")
			.send({ ordinal: "1" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(refusalsIn(harness)).toEqual([
			expect.objectContaining({
				path: "/queue/:id/issue-links",
				status: 303,
				code: "no_write_access",
				user_id: userId,
			}),
		]);
	});

	it("records a 422 from the save dialog as other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").set("HX-Request", "true").type("form").send({ url: "not a url" });

		expect(response.status).toBe(422);
		expect(refusalsIn(harness)).toEqual([
			expect.objectContaining({ path: "/queue/save", status: 422, code: "other" }),
		]);
	});

	it("records nothing for a save that lands on the queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });

		expect(response.status).toBe(303);
		expect(refusalsIn(harness)).toEqual([]);
	});
});
