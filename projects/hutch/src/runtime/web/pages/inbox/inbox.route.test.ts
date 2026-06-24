import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { loginAgent, useTestServer } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	type TestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

/** A fixture whose server clock runs `days` ahead of real time, so a freshly
 * created user lands past the 7-day verification window — i.e. locked — with no
 * way to backdate `registeredAt` directly. */
function fixtureClockedDaysAhead(days: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => new Date(Date.now() + days * ONE_DAY_MS);
	return fixture;
}

/** Older than the bot-defense minimum submit window (2.5s) so signup passes. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

function addressFieldValue(html: string): string | null | undefined {
	return new JSDOM(html).window.document
		.querySelector(".inbox__address-field")
		?.getAttribute("value");
}

/** Mints live addresses through the real store until the user sits exactly at the
 * per-user cap, so the next create is rejected the way production rejects it (the
 * in-memory fixture faithfully throws at the limit) instead of by stubbing the
 * throw. */
async function seedAddressesToCap(fixture: TestAppFixture, userId: UserId): Promise<void> {
	for (let i = 0; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
		await fixture.inboxAddress.inboxAddressStore.createAddress({ userId, domain: "read.place" });
	}
}

describe("Inbox address routes", () => {
	describe("GET /inbox/addresses (gating)", () => {
		it("redirects an unauthenticated visitor to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/inbox/addresses?feature=email");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("returns 404 for an authenticated user without the email feature flag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses");

			expect(response.status).toBe(404);
		});

		it("renders the empty state with a create CTA when the flagged user has no addresses", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?feature=email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-inbox-empty]")).not.toBeNull();
			expect(doc.querySelector("[data-test-inbox-create]")).not.toBeNull();
			expect(doc.querySelector("[data-test-inbox-list]")).toBeNull();
		});

		it("shows the limit banner proactively at the cap without the &error=limit param", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await seedAddressesToCap(fixture, userId);

			const response = await agent.get("/inbox/addresses?feature=email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-inbox-limit]")).not.toBeNull();
		});

		it("shows the limit banner from the &error=limit flag even when the live count is below the cap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?feature=email&error=limit");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-inbox-limit]")).not.toBeNull();
		});
	});

	describe("POST /inbox/create", () => {
		it("creates an address and surfaces it on the next visit to the addresses page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent.post("/inbox/create?feature=email");
			expect(created.status).toBe(303);
			expect(created.headers.location).toBe("/inbox/addresses?feature=email");

			const listed = await agent.get("/inbox/addresses?feature=email");
			expect(addressFieldValue(listed.text)).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
		});

		it("returns 404 without the feature flag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create");

			expect(response.status).toBe(404);
		});

		it("redirects a read-only user to /queue?inactive=1 and mints nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const response = await agent.post("/inbox/create?feature=email").set("Accept", "text/html");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?inactive=1");
			const listed = await agent.get("/inbox/addresses?feature=email");
			expect(addressFieldValue(listed.text)).toBeUndefined();
		});

		it("blocks a locked user with the account-locked screen and mints nothing", async () => {
			const harness = useApp(fixtureClockedDaysAhead(8));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/inbox/create?feature=email").set("Accept", "text/html");

			expect(response.status).toBe(403);
			expect(
				new JSDOM(response.text).window.document.querySelector("h1")?.textContent,
			).toBe("Your account is locked");
			const listed = await agent.get("/inbox/addresses?feature=email");
			expect(addressFieldValue(listed.text)).toBeUndefined();
		});

		it("surfaces the per-user limit message without logging an error when the cap is reached", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errors: string[] = [];
			fixture.shared.logError = (message) => {
				errors.push(message);
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			await seedAddressesToCap(fixture, userId);

			const response = await agent.post("/inbox/create?feature=email");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/inbox/addresses?feature=email&error=limit");
			expect(errors.some((m) => m.includes("[Inbox] Failed to create"))).toBe(false);

			const listed = await agent.get("/inbox/addresses?feature=email&error=limit");
			const doc = new JSDOM(listed.text).window.document;
			expect(doc.querySelector("[data-test-inbox-limit]")).not.toBeNull();
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
			expect(response.headers.location).toBe("/inbox/addresses?feature=email&error=create");
			expect(errors.some((m) => m.includes("[Inbox] Failed to create"))).toBe(true);
		});

		it("renders a graceful error indicator on the redirect target after a failed create", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.shared.logError = () => {};
			fixture.inboxAddress.inboxAddressStore.createAddress = async () => {
				throw new Error("dynamo down");
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent.post("/inbox/create?feature=email");
			const landing = await agent.get(created.headers.location);

			expect(landing.status).toBe(200);
			expect(
				new JSDOM(landing.text).window.document.querySelector("[data-test-inbox-error]"),
			).not.toBeNull();
		});

		it("does not render the error indicator on a normal visit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox/addresses?feature=email");

			expect(
				new JSDOM(response.text).window.document.querySelector("[data-test-inbox-error]"),
			).toBeNull();
		});
	});

	describe("POST /inbox/disable", () => {
		it("disables an address the user owns", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/inbox/create?feature=email");
			const address = addressFieldValue(
				(await agent.get("/inbox/addresses?feature=email")).text,
			);
			expect(address).not.toBeNull();

			const response = await agent
				.post("/inbox/disable?feature=email")
				.type("form")
				.send({ address: address ?? "" });

			expect(response.status).toBe(303);
			const after = new JSDOM(
				(await agent.get("/inbox/addresses?feature=email")).text,
			).window.document;
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
			const after = new JSDOM(
				(await agent.get("/inbox/addresses?feature=email")).text,
			).window.document;
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
			const after = new JSDOM(
				(await agent.get("/inbox/addresses?feature=email")).text,
			).window.document;
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
