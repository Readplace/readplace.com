import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "./test-app";

const useApp = useTestServer();

describe("utm validation", () => {
	it("400s the apostrophe a scanner appends to utm_source, before it can reach the analytics log", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/?utm_source='");

		expect(response.status).toBe(400);
		expect(harness.analytics.events).toHaveLength(0);
	});

	it("400s an apostrophe appended to the utm_source our own /install link carries", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get(
			"/install?utm_source=reader-failed'&utm_medium=banner&utm_campaign=extension-suggestion",
		);

		expect(response.status).toBe(400);
		expect(harness.analytics.events).toHaveLength(0);
	});

	it("still serves a campaign link whose utm values are well-formed, and still counts the pageview", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server)
			.get("/?utm_source=fagnerbrack.com&utm_content=top")
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(harness.analytics.events).toHaveLength(1);
		expect(harness.analytics.events[0]).toMatchObject({
			event: "pageview",
			utm_source: "fagnerbrack.com",
			utm_content: "top",
		});
	});

	it("leaves a non-utm query param carrying an apostrophe alone, so searching the queue for one still works", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/login?return=/queue%3Fq%3Dit%27s");

		expect(response.status).toBe(200);
	});
});
