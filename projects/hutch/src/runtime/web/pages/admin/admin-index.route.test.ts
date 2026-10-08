import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";

const useApp = useTestServer();
function buildHarness(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	return useApp({
		...fixture,
		admin: {
			adminEmails: [ADMIN_EMAIL],
			recrawlServiceToken: fixture.admin.recrawlServiceToken,
		},
	});
}

async function loginAs(input: { server: Server; email: string; password: string }) {
	const agent = request.agent(input.server);
	await agent.post("/login").type("form").send({ email: input.email, password: input.password });
	return agent;
}

describe("GET /admin", () => {
	it("links an admin to every operator tool with its click tracked", async () => {
		const harness = buildHarness();
		await harness.auth.createUser({
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});
		const agent = await loginAs({
			server: harness.server,
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});

		const response = await agent.get("/admin");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.body.classList.contains("page-admin"), true);
		const links = Array.from(document.querySelectorAll("[data-test-admin-link]")).map((button) => {
			const form = button.closest("form");
			assert(form, "each admin link is a form");
			return [
				button.getAttribute("data-test-admin-link"),
				form.getAttribute("method"),
				form.getAttribute("action"),
				Object.fromEntries(
					Array.from(form.querySelectorAll('input[type="hidden"]')).map((input) => [
						input.getAttribute("name"),
						input.getAttribute("value"),
					]),
				),
			];
		});
		const tracked = (content: string) => ({
			utm_source: "admin-index",
			utm_medium: "internal",
			utm_content: content,
		});
		assert.deepEqual(links, [
			["newsletters", "GET", "/admin/newsletters", tracked("newsletters")],
			["recrawl", "GET", "/admin/recrawl", tracked("recrawl")],
			["extend-trial", "GET", "/admin/extend-trial", tracked("extend-trial")],
		]);
	});

	it("sends a signed-out visitor to login", async () => {
		const harness = buildHarness();

		const response = await request(harness.server).get("/admin");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("does not accept the recrawl service token in place of a session", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = buildHarness(fixture);

		const response = await request(harness.server).get("/admin").set("x-service-token", fixture.admin.recrawlServiceToken);

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("refuses a signed-in reader who is not an admin", async () => {
		const harness = buildHarness();
		await harness.auth.createUser({
			email: USER_EMAIL,
			password: USER_PASSWORD,
		});
		const agent = await loginAs({
			server: harness.server,
			email: USER_EMAIL,
			password: USER_PASSWORD,
		});

		const response = await agent.get("/admin");

		assert.equal(response.status, 403);
		const doc = new JSDOM(response.text).window.document;
		assert.ok(doc.body.classList.contains("page-admin-forbidden"), "the refusal renders inside the site shell");
		assert.equal(doc.querySelector("[data-test-admin-forbidden] h1")?.textContent, "Admin access required");
		assert.equal(doc.querySelector("[data-test-admin-link]"), null);
	});
});
