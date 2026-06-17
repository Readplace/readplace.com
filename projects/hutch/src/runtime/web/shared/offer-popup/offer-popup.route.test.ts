import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

async function loginUser(
	harness: ReturnType<ReturnType<typeof useTestServer>>,
	email: string,
) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

function hasPopup(html: string): boolean {
	const doc = new JSDOM(html).window.document;
	return (
		doc.querySelector("[data-test-offer-popup]") !== null &&
		html.includes("offer-popup.client.js") &&
		html.includes(".offer-popup__panel")
	);
}

describe("Founding-offer popup gating", () => {
	it("does not ship the popup for a founding member on any page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const queue = await agent.get("/queue");
		const home = await agent.get("/");

		expect(queue.status).toBe(200);
		expect(hasPopup(queue.text)).toBe(false);
		expect(hasPopup(home.text)).toBe(false);
	});

	it("ships the popup on every page for a locked-out user whose trial has ended", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "expired@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - 1000).toISOString(),
		});

		const queue = await agent.get("/queue");
		const home = await agent.get("/");

		expect(hasPopup(queue.text)).toBe(true);
		expect(hasPopup(home.text)).toBe(true);
	});
});
