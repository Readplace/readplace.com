import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../test-app";

const useApp = useTestServer();
const APP_ORIGIN = "https://readplace.com";
const SESSION = "hutch_sid=any-session";

describe("cross-site requests that ride on the session cookie", () => {
	it.each([
		["Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
		["Sec-Fetch-Site same-site", { "Sec-Fetch-Site": "same-site" }],
		["a foreign Origin without Sec-Fetch-Site", { Origin: "https://example.org" }],
		["Origin null without Sec-Fetch-Site", { Origin: "null" }],
	])("refuses a POST with %s", async (_case, headers) => {
		const harness = useApp(createDefaultTestAppFixture(APP_ORIGIN));
		const response = await request(harness.server).post("/logout").set("Cookie", SESSION).set(headers);
		expect(response.status).toBe(403);
	});

	it.each([
		["Sec-Fetch-Site same-origin", { "Sec-Fetch-Site": "same-origin" }],
		["Sec-Fetch-Site none", { "Sec-Fetch-Site": "none" }],
		["the app's own Origin", { Origin: APP_ORIGIN }],
		["no browser headers, as a native client sends", {}],
	])("lets a POST with %s through", async (_case, headers) => {
		const harness = useApp(createDefaultTestAppFixture(APP_ORIGIN));
		const response = await request(harness.server).post("/logout").set("Cookie", SESSION).set(headers);
		expect(response.status).not.toBe(403);
	});

	it("lets a cross-site POST through when it carries no session cookie", async () => {
		const harness = useApp(createDefaultTestAppFixture(APP_ORIGIN));
		const response = await request(harness.server).post("/logout").set("Sec-Fetch-Site", "cross-site");
		expect(response.status).not.toBe(403);
	});

	it("lets a cross-site POST through when it authenticates with a bearer token", async () => {
		const harness = useApp(createDefaultTestAppFixture(APP_ORIGIN));
		const response = await request(harness.server)
			.post("/logout")
			.set("Cookie", SESSION)
			.set("Authorization", "Bearer any-token")
			.set("Sec-Fetch-Site", "cross-site");
		expect(response.status).not.toBe(403);
	});

	it("lets a cross-site GET through", async () => {
		const harness = useApp(createDefaultTestAppFixture(APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Cookie", SESSION).set("Sec-Fetch-Site", "cross-site");
		expect(response.status).not.toBe(403);
	});
});
