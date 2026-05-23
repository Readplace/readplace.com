import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

async function loginUser(harness: ReturnType<ReturnType<typeof useTestServer>>, email: string) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

describe("Queue page banner state", () => {
	it("renders the aside with state class `queue-banner--none` and no header countdown for a founding member (no row)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must always be rendered");
		expect(banner.classList.contains("queue-banner--none")).toBe(true);
		expect(doc.querySelector("[data-test-trial-countdown]")).toBeNull();
	});

	it("renders the header trial countdown with `Xd Xh Xm Xs in your free trial` for a trialing user, while the queue aside stays in the `none` state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trialing@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "global trial countdown must be rendered for a trialing user");
		expect(countdown.getAttribute("data-trial-state")).toBe("active");
		expect(countdown.textContent).toMatch(/^\d+d \d+h \d+m \d+s in your free trial$/);
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must still be rendered");
		expect(banner.classList.contains("queue-banner--none")).toBe(true);
	});

	it("flips the header countdown to 'Free trial is over!' and disables the save form after the trial window ends", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "expired-trial@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "global trial countdown must be rendered for an expired-trial user");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.textContent).toBe("Free trial is over!");
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must still be rendered");
		expect(saveForm.classList.contains("queue__save-form--disabled")).toBe(true);
		const submitButton = saveForm.querySelector("button[type='submit']");
		assert(submitButton, "save button must still be rendered");
		expect(submitButton.hasAttribute("disabled")).toBe(true);
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must still be rendered (it's now empty for inactive)");
		expect(banner.classList.contains("queue-banner--none")).toBe(true);
	});

	it("renders the pending-cancellation aside with the formatted effective date for users mid-cancellation, and no header countdown", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "pending-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pc",
			customerId: "cus_pc",
		});
		const effectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: effectiveAt,
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must always be rendered");
		expect(banner.classList.contains("queue-banner--pending-cancellation")).toBe(true);
		expect(banner.querySelector("time")?.getAttribute("datetime")).toBe(effectiveAt);
		expect(banner.querySelector(".queue-banner__cta")?.getAttribute("href")).toBe("/account");
		expect(doc.querySelector("[data-test-trial-countdown]")).toBeNull();
	});

	it("flips the header countdown to 'Free trial is over!' for a cancelled user too, with the same wording as trial-expired", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-user@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_cancelled" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "global trial countdown must be rendered for a cancelled user");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.textContent).toBe("Free trial is over!");
	});
});

describe("POST /queue/save read-only gating", () => {
	it("returns a 303 redirect to /queue?inactive=1 when an html client tries to save while inactive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "noaccess-html@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_locked",
			customerId: "cus_locked",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_locked" });

		const response = await agent
			.post("/queue/save")
			.set("Accept", "text/html")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("allows a paid-active user to keep saving so the gate only fires when access is read-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "paid-saves@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_paying",
			customerId: "cus_paying",
		});

		const response = await agent
			.post("/queue/save")
			.set("Accept", "text/html")
			.type("form")
			.send({ url: "https://example.com/paid-article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue#latest-saved");
	});
});
