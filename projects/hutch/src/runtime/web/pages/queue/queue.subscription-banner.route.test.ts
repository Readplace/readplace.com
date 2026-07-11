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
	it("renders the aside with state class `queue-banner--none` and an enabled save form for a founding member (no row)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must always be rendered");
		expect(banner.classList.contains("queue-banner--none")).toBe(true);
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must be rendered with full access for a founding member");
		expect(saveForm.classList.contains("queue__save-form--disabled")).toBe(false);
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown element must always be in the DOM");
		expect(countdown.classList.contains("trial-countdown--hidden")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("");
	});

	it("renders the header trial countdown and the queue aside trial-countdown banner for a trialing user", async () => {
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
		expect(countdown.textContent).toMatch(
			/^(\d+d \d+h|\d+h \d+m|\d+m \d+s|\d+s) left in your free trial$/,
		);
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must be rendered");
		expect(banner.classList.contains("queue-banner--trial-countdown")).toBe(true);
	});

	it("flips the header countdown to 'Subscription not active' and disables the save form after the trial window ends", async () => {
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
		expect(countdown.textContent).toBe("Subscription not active");
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must still be rendered");
		expect(saveForm.classList.contains("queue__save-form--disabled")).toBe(true);
		const submitButton = saveForm.querySelector("button[type='submit']");
		assert(submitButton, "save button must still be rendered");
		expect(submitButton.hasAttribute("disabled")).toBe(true);
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner aside must be rendered");
		expect(banner.classList.contains("queue-banner--inactive")).toBe(true);
		// Trial expiry is how the entire churned cohort reaches the inactive
		// state, so the re-subscribe CTA must be present on this path too.
		const cta = banner.querySelector('[data-test-action="resubscribe"]');
		assert(cta, "expired-trial inactive banner must offer a resubscribe CTA");
		expect(cta.textContent).toBe("Subscribe — $49/year");
		const ctaHref = cta.getAttribute("href");
		assert(ctaHref, "resubscribe CTA must have an href");
		expect(ctaHref).toContain("/account");
		expect(ctaHref).toContain("utm_content=resubscribe");
	});

	it("shows cancellation-scheduled banner with full access when pending_cancellation is before effectiveAt", async () => {
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
		assert(banner, "queue banner must always be rendered");
		expect(banner.classList.contains("queue-banner--cancellation-scheduled")).toBe(true);
		const message = banner.querySelector("[data-test-banner-message]");
		assert(message, "cancellation-scheduled banner must render its message");
		const time = message.querySelector("time[data-local-time='date']");
		assert(time, "cancellation-scheduled banner must render the end date as a <time> element");
		expect(time.getAttribute("datetime")).toBe(effectiveAt);
		expect(message.textContent?.replace(/\s+/g, " ").trim()).toMatch(
			/^Subscription ending [A-Z][a-z]{2} \d{1,2}, \d{4}\. You still have full access until then\.$/,
		);
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must be rendered with full access");
		expect(saveForm.classList.contains("queue__save-form--disabled")).toBe(false);
	});

	it("flips banner to inactive and disables save after the cancellation window elapses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "past-pending-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pc_past",
			customerId: "cus_pc_past",
		});
		const effectiveAt = new Date(Date.now() - ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: effectiveAt,
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "queue banner must always be rendered");
		expect(banner.classList.contains("queue-banner--inactive")).toBe(true);
		const message = banner.querySelector("[data-test-banner-message]");
		assert(message, "inactive banner must render its message");
		expect(message.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Subscription not active. Your saved articles are still here.",
		);
		// An expired/cancelled user must be able to re-subscribe from the queue
		// itself, not be dead-ended into hunting for /account.
		const cta = banner.querySelector('[data-test-action="resubscribe"]');
		assert(cta, "inactive banner must offer a subscribe CTA");
		expect(cta.textContent).toBe("Subscribe — $49/year");
		const ctaHref = cta.getAttribute("href");
		assert(ctaHref, "inactive banner CTA must have an href");
		expect(ctaHref).toContain("/account");
		expect(ctaHref).toContain("utm_content=resubscribe");
	});

	it("flips the header countdown to 'Subscription not active' for a cancelled user too, with the same wording as trial-expired", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-user@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "global trial countdown must be rendered for a cancelled user");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.textContent).toBe("Subscription not active");
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
		await subscriptionProviders.markCancelledByUserId({ userId });

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
