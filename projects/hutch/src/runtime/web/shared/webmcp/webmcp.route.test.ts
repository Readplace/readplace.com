import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

/**
 * The WebMCP `save_article` tool runs in the page and can only authenticate with
 * the `hutch_sid` session cookie — it has no OAuth Bearer token. These tests pin
 * the server contract the tool relies on: a cookie-only, form-encoded POST to
 * `/queue/save` actually saves (rather than 401ing like the Bearer-gated Siren
 * `POST /queue`), and the redirect outcomes the tool classifies — signed-out and
 * inactive-subscription — are the ones the route really emits. The client unit
 * test fakes `fetch`, so without this the auth contract would go unverified.
 */
describe("POST /queue/save — WebMCP save_article cookie-auth contract", () => {
	it("saves a form-encoded url for a cookie session and redirects to the queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, articleStore } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/post" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue#latest-saved");

		const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
		assert.ok(userId, "logged-in test user should exist");
		const stored = await articleStore.findArticlesByUser({ userId });
		expect(stored.articles).toHaveLength(1);
		expect(stored.articles[0].url).toContain("example.com/post");
	});

	it("redirects a signed-out visitor to /login instead of 401ing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/post" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("redirects an inactive subscription to /queue?inactive=1 and saves nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, subscriptionProviders, articleStore } = harness;
		const agent = await loginAgent(harness.server, auth);
		const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
		assert.ok(userId, "logged-in test user should exist");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/post" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");

		const stored = await articleStore.findArticlesByUser({ userId });
		expect(stored.articles).toHaveLength(0);
	});
});
