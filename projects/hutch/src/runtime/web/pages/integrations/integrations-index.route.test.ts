import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

describe("GET /integrations", () => {
	it("redirects an anonymous reader to the login page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/integrations");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("lists the services for a signed-in reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/integrations");

		expect(response.status).toBe(200);
		const doc = load(response.text);
		const services = Array.from(doc.querySelectorAll("[data-test-integration]")).map((el) =>
			el.getAttribute("data-test-integration"),
		);
		expect(services).toEqual(["gmail"]);
	});

	it("shows Gmail as not set up", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations")).text);

		const gmail = doc.querySelector('[data-test-integration="gmail"]');
		assert(gmail, "the Gmail row must render");
		const status = gmail.querySelector("[data-test-integration-status]");
		assert(status, "the Gmail row must carry a status");
		expect(status.getAttribute("data-test-integration-status")).toBe("not-set-up");
		expect(status.textContent).toBe("Not set up");
	});

	it("renders the alert an interrupted connection redirects back with", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations?error=oauth_state")).text);

		const alert = doc.querySelector("[data-test-integrations-alert-key]");
		assert(alert, "the index must render an alert for a redirect that carried an error");
		expect(alert.getAttribute("data-test-integrations-alert-key")).toBe("oauth_state");
	});

	it("renders the notice a completed connection redirects back with", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations?connected=1")).text);

		const notice = doc.querySelector("[data-test-integrations-notice-key]");
		assert(notice, "the index must confirm a connection the redirect reported");
		expect(notice.getAttribute("data-test-integrations-notice-key")).toBe("connected");
	});

	it("keeps the page out of search results", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations")).text);

		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "the page must declare a robots policy");
		expect(robots.getAttribute("content")).toBe("noindex, nofollow");
	});
});

describe("Integrations nav entry", () => {
	it("is absent from the header for a reader who did not opt in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/queue")).text);

		const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) =>
			el.getAttribute("data-test-nav-item"),
		);
		expect(navItems).not.toContain("integrations");
	});

	it("appears in the header for a reader who opted in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/queue?feature=gmail")).text);

		const entry = doc.querySelector('[data-test-nav-item="integrations"]');
		assert(entry, "the integrations nav entry must render for an opted-in reader");
		const form = entry.closest("form");
		assert(form, "every nav entry renders inside a form");
		expect(form.getAttribute("action")).toBe(
			"/integrations?utm_source=header-nav&utm_medium=internal&utm_content=integrations",
		);
	});
});
