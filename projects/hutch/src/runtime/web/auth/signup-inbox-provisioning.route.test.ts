import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

/** Older than the bot-defense minimum submit window (2.5s) so signup passes. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

describe("signup provisioning", () => {
	it("provisions one forwarding address when a new account is created", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);

		const response = await request(harness.server).post("/signup").type("form").send({
			email: "new@example.com",
			password: "password123",
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
			loadedAt: freshLoadedAt(),
		});

		expect(response.status).toBe(303);
		expect(errors.some((m) => m.includes("[Inbox] Failed to provision"))).toBe(true);
	});
});
