import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

describe("Inbox app composition", () => {
	it("serves nothing outside /inbox — the rest of the origin belongs to hutch", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/queue");

		expect(response.status).toBe(404);
	});

	it("resolves the hutch session cookie into an authenticated request", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(200);
	});

	it("degrades to guest and logs when the session lookup fails, instead of 500ing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		fixture.auth.getSessionUserId = async () => {
			throw new Error("dynamo down");
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
		expect(errors.some((m) => m.includes("session lookup failed"))).toBe(true);
	});

	it("leaves the changelog banner for the browser to fetch from the blog, returning to the inbox page it is shown on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			".banner-area [data-test-changelog-banner]",
		);
		assert(banner, "the changelog banner placeholder must render");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
		const url = new URL(String(banner.getAttribute("hx-get")), TEST_APP_ORIGIN);
		expect(url.pathname).toBe("/blog/changelog-banner");
		expect(url.searchParams.get("returnTo")).toBe("/inbox");
	});
});
