import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

/** Older than the bot-defense minimum submit window (2.5s) so signup passes. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

function navItemKeys(html: string): (string | null)[] {
	const doc = new JSDOM(html).window.document;
	return Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) =>
		el.getAttribute("data-test-nav-item"),
	);
}

function addressFieldValue(html: string): string | null | undefined {
	return new JSDOM(html).window.document
		.querySelector(".inbox__address-field")
		?.getAttribute("value");
}

describe("Inbox routes", () => {
	describe("GET /inbox (gating)", () => {
		it("redirects an unauthenticated visitor to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/inbox?feature=email");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("returns 404 for an authenticated user without the email feature flag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox");

			expect(response.status).toBe(404);
		});

		it("renders the empty state with a create CTA when the flagged user has no addresses", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox?feature=email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-inbox-empty]")).not.toBeNull();
			expect(doc.querySelector("[data-test-inbox-create]")).not.toBeNull();
			expect(doc.querySelector("[data-test-inbox-list]")).toBeNull();
		});
	});

	describe("nav entry", () => {
		it("shows the Inbox nav entry only when the email feature flag is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const withFlag = await agent.get("/queue?feature=email");
			expect(navItemKeys(withFlag.text)).toContain("inbox");

			const withoutFlag = await agent.get("/queue");
			expect(navItemKeys(withoutFlag.text)).not.toContain("inbox");
		});
	});

	describe("POST /inbox/create", () => {
		it("creates an address and surfaces it on the next visit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent.post("/inbox/create?feature=email");
			expect(created.status).toBe(303);
			expect(created.headers.location).toBe("/inbox?feature=email");

			const listed = await agent.get("/inbox?feature=email");
			expect(addressFieldValue(listed.text)).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
		});

		it("returns 404 without the feature flag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create");

			expect(response.status).toBe(404);
		});

		it("redirects gracefully and logs when address creation fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errors: string[] = [];
			fixture.shared.logError = (message) => {
				errors.push(message);
			};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw new Error("dynamo down");
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create?feature=email");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox?feature=email");
			expect(errors.some((m) => m.includes("[Inbox] Failed to create"))).toBe(true);
		});
	});

	describe("POST /inbox/disable", () => {
		it("disables an address the user owns", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create?feature=email");
			const address = addressFieldValue((await agent.get("/inbox?feature=email")).text);
			expect(address).not.toBeNull();

			const response = await agent
				.post("/inbox/disable?feature=email")
				.type("form")
				.send({ address: address ?? "" });

			expect(response.status).toBe(303);
			const after = new JSDOM((await agent.get("/inbox?feature=email")).text).window.document;
			expect(after.querySelector('[data-test-inbox-status="disabled"]')).not.toBeNull();
			expect(after.querySelector("[data-test-inbox-disable]")).toBeNull();
		});

		it("ignores a request whose body is not a valid address", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create?feature=email");

			const response = await agent
				.post("/inbox/disable?feature=email")
				.type("form")
				.send({ address: "not-an-address" });

			expect(response.status).toBe(303);
			const after = new JSDOM((await agent.get("/inbox?feature=email")).text).window.document;
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).not.toBeNull();
		});

		it("does not disable an address the user does not own", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create?feature=email");

			const response = await agent
				.post("/inbox/disable?feature=email")
				.type("form")
				.send({ address: "in-zzzzzz@read.place" });

			expect(response.status).toBe(303);
			const after = new JSDOM((await agent.get("/inbox?feature=email")).text).window.document;
			expect(after.querySelector('[data-test-inbox-status="enabled"]')).not.toBeNull();
		});
	});

	describe("signup provisioning", () => {
		it("provisions one forwarding address when a new account is created", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "new@example.com",
				password: "password123",
				confirmPassword: "password123",
				loadedAt: freshLoadedAt(),
			});
			expect(response.status).toBe(303);

			const user = await fixture.auth.findUserByEmail("new@example.com");
			assert(user, "signup must persist a user");
			const addresses = await fixture.inboxAddress.inboxAddressStore.listAddressesByUserId(
				user.userId,
			);
			expect(addresses).toHaveLength(1);
		});

		it("still completes signup when address provisioning throws", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errors: string[] = [];
			fixture.shared.logError = (message) => {
				errors.push(message);
			};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw new Error("dynamo down");
			};
			const harness = useApp(fixture);

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "resilient@example.com",
				password: "password123",
				confirmPassword: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(errors.some((m) => m.includes("[Inbox] Failed to provision"))).toBe(true);
		});
	});
});
