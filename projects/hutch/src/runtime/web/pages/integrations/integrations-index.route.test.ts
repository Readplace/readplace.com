import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function integrationActions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-integration-action]")).map((el) =>
		el.getAttribute("data-test-integration-action"),
	);
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
		expect(status.getAttribute("data-test-integration-status")).toBe("disconnected");
		expect(status.textContent).toBe("Not set up");
	});

	it("offers only Connect to a reader with no connection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations")).text);

		expect(integrationActions(doc)).toEqual(["connect"]);
	});

	it("routes a connected-but-unconfirmed reader to finish setup on the Gmail page", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: {
				ok: true,
				grant: {
					refreshToken: "refresh-value",
					accessToken: "access-value",
					grantedScope: GMAIL_SETTINGS_SCOPE,
				},
			},
		});
		const harness = useApp({
			...createDefaultTestAppFixture(TEST_APP_ORIGIN),
			gmailIntegration: gmail.bundle,
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress: GATEWAY });

		const doc = load((await agent.get("/integrations")).text);

		expect(integrationActions(doc)).toEqual(["finish-setup"]);
		const action = doc.querySelector("[data-test-integration-action='finish-setup']");
		assert(action, "the finish-setup action renders");
		const form = action.closest("form");
		assert(form, "the finish-setup action navigates via a form");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/integrations/gmail");
	});

	it("renders the alert an interrupted connection redirects back with", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/integrations?error=oauth_state")).text);

		const alert = doc.querySelector("[data-test-integrations-alert-key]");
		assert(alert, "the index must render an alert for a redirect that carried an error");
		expect(alert.getAttribute("data-test-integrations-alert-key")).toBe("oauth_state");
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
