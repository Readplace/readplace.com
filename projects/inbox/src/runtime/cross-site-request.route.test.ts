import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();
const FEEDBACK_PATH = "/inbox/any-email/links/0/feedback";

describe("cross-site requests that ride on the session cookie", () => {
	it.each([
		["Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
		["a foreign Origin without Sec-Fetch-Site", { Origin: "https://example.org" }],
	])("refuses a POST with %s", async (_case, headers) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(FEEDBACK_PATH).set(headers);

		expect(response.status).toBe(403);
	});

	it.each([
		["Sec-Fetch-Site same-origin", { "Sec-Fetch-Site": "same-origin" }],
		["the app's own Origin", { Origin: TEST_APP_ORIGIN }],
		["no browser headers, as a native client sends", {}],
	])("lets a POST with %s through", async (_case, headers) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(FEEDBACK_PATH).set(headers);

		expect(response.status).not.toBe(403);
	});

	it("lets a cross-site POST through when it carries no session cookie", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(FEEDBACK_PATH).set("Sec-Fetch-Site", "cross-site");

		expect(response.status).not.toBe(403);
	});
});
