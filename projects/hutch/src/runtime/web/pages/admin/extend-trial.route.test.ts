import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";

const NEW_TRIAL_END = "2027-03-01T10:30";
const NEW_TRIAL_END_ISO = "2027-03-01T10:30:00.000Z";
const NEW_REMINDER_ISO = "2027-02-27T10:30:00.000Z";

const EXISTING_TRIAL_END = "2026-08-01T00:00:00.000Z";
const EXISTING_REMINDER = "2026-07-30T00:00:00.000Z";

const useApp = useTestServer();

function buildHarness(options?: { adminEmails?: readonly string[] }) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return useApp({
		...fixture,
		admin: {
			adminEmails: options?.adminEmails ?? [ADMIN_EMAIL],
			recrawlServiceToken: fixture.admin.recrawlServiceToken,
		},
	});
}

async function loginAs(server: Server, email: string, password: string) {
	const agent = request.agent(server);
	await agent.post("/login").type("form").send({ email, password });
	return agent;
}

function doc(html: string) {
	return new JSDOM(html).window.document;
}

async function createAdmin(harness: ReturnType<typeof buildHarness>) {
	await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
	return loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function userId(harness: ReturnType<typeof buildHarness>) {
	const user = await harness.auth.findUserByEmail(USER_EMAIL);
	if (!user) throw new Error("test user should exist");
	return user.userId;
}

/** A user mid-trial with the trial-end and reminder one-shots actually armed.
 * The live schedules matter: EventBridge rejects a duplicate schedule name, so
 * extending has to delete before it creates or the whole thing conflicts. */
async function createTrialingUser(harness: ReturnType<typeof buildHarness>) {
	await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
	const id = await userId(harness);
	await harness.subscriptionProviders.upsertTrialing({
		userId: id,
		trialEndsAt: EXISTING_TRIAL_END,
	});
	await harness.trialScheduler.createTrialEndSchedule({
		userId: id,
		firesAt: EXISTING_TRIAL_END,
	});
	await harness.trialScheduler.createTrialReminderSchedule({
		userId: id,
		firesAt: EXISTING_REMINDER,
	});
	return id;
}

/** No subscription row at all — that IS a founding member. */
async function createFoundingUser(harness: ReturnType<typeof buildHarness>) {
	await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
	return userId(harness);
}

describe("Admin extend-trial routes", () => {
	describe("authorization", () => {
		it("redirects unauthenticated visitors to /login", async () => {
			const { server } = buildHarness();

			const response = await request(server).get("/admin/extend-trial");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("forbids an authenticated non-admin", async () => {
			const harness = buildHarness();
			await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
			const agent = await loginAs(harness.server, USER_EMAIL, USER_PASSWORD);

			const response = await agent.get("/admin/extend-trial");

			expect(response.status).toBe(403);
		});

		it("forbids everyone when the allowlist is empty", async () => {
			const harness = buildHarness({ adminEmails: [] });
			const agent = await createAdmin(harness);

			const response = await agent.get("/admin/extend-trial");

			expect(response.status).toBe(403);
		});
	});

	describe("lookup", () => {
		it("reports an unknown email", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);

			const response = await agent.get("/admin/extend-trial?email=nobody@example.com");

			expect(response.status).toBe(200);
			const notFound = doc(response.text).querySelector("[data-test-extend-trial-not-found]");
			expect(notFound?.textContent?.trim()).toBe("No account with that email.");
		});

		it("refuses a founding member instead of downgrading them", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			await createFoundingUser(harness);

			const response = await agent.get(`/admin/extend-trial?email=${USER_EMAIL}`);

			const refusal = doc(response.text).querySelector("[data-test-extend-trial-refusal]");
			expect(refusal?.textContent).toContain("founding member");
		});

		it("shows the current window and prefills the date for a trialing user", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			await createTrialingUser(harness);

			const response = await agent.get(`/admin/extend-trial?email=${USER_EMAIL}`);

			const page = doc(response.text);
			expect(page.querySelector("[data-test-extend-trial-status]")?.textContent?.trim()).toBe(
				"trialing",
			);
			expect(page.querySelector("[data-test-extend-trial-current]")?.textContent?.trim()).toBe(
				EXISTING_TRIAL_END,
			);
			// Prefilled with the window they already have, so a blind submit is a no-op.
			expect(page.querySelector("[data-test-extend-trial-date]")?.getAttribute("value")).toBe(
				"2026-08-01T00:00",
			);
		});
	});

	describe("extending", () => {
		it("re-opens the window and re-arms both schedules", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createTrialingUser(harness);

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: NEW_TRIAL_END });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/admin/extend-trial?email=${encodeURIComponent(USER_EMAIL)}&extended=1`,
			);

			const row = await harness.subscriptionProviders.findByUserId(id);
			expect(row?.status).toBe("trialing");
			expect(row?.trialEndsAt).toBe(NEW_TRIAL_END_ISO);
			expect(harness.trialScheduler.getSchedule(id)).toBe(NEW_TRIAL_END_ISO);
			expect(harness.trialScheduler.getTrialReminderSchedule(id)).toBe(NEW_REMINDER_ISO);
		});

		it("is idempotent — a second submit overrides instead of colliding", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createTrialingUser(harness);

			await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: NEW_TRIAL_END });
			const second = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: "2027-04-01T09:00" });

			expect(second.status).toBe(303);
			const row = await harness.subscriptionProviders.findByUserId(id);
			expect(row?.trialEndsAt).toBe("2027-04-01T09:00:00.000Z");
			expect(harness.trialScheduler.getSchedule(id)).toBe("2027-04-01T09:00:00.000Z");
		});

		it("re-opens a lapsed trial and clears the sent-email markers", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createFoundingUser(harness);
			// The real shape of a lapsed card-less trial in production: cancelled, no
			// Stripe ids, feedback email already sent, no schedules left.
			harness.subscriptionProviders.seedRow({
				userId: id,
				provider: "stripe",
				status: "cancelled",
				createdAt: "2026-06-20T09:30:31.367Z",
				updatedAt: "2026-07-07T10:31:16.403Z",
				trialFeedbackEmailSentAt: "2026-07-07T10:31:16.403Z",
				trialReminderEmailSentAt: "2026-07-02T10:31:16.403Z",
			});

			await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: NEW_TRIAL_END });

			const row = await harness.subscriptionProviders.findByUserId(id);
			expect(row?.status).toBe("trialing");
			expect(row?.trialEndsAt).toBe(NEW_TRIAL_END_ISO);
			// Sticky markers would silence the reminder for the new window.
			expect(row?.trialReminderEmailSentAt).toBeUndefined();
			expect(row?.trialFeedbackEmailSentAt).toBeUndefined();
		});

		it("rejects a date in the past and changes nothing", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createTrialingUser(harness);

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: "2020-01-01T00:00" });

			expect(response.status).toBe(422);
			const refusal = doc(response.text).querySelector("[data-test-extend-trial-refusal]");
			expect(refusal?.textContent).toContain("has to end in the future");
			const row = await harness.subscriptionProviders.findByUserId(id);
			expect(row?.trialEndsAt).toBe(EXISTING_TRIAL_END);
		});

		it("rejects a malformed date", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			await createTrialingUser(harness);

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: "not-a-date" });

			expect(response.status).toBe(422);
			const error = doc(response.text).querySelector('[data-test-error="trialEndsAt"]');
			expect(error?.textContent?.trim()).toBe("Choose a date and time");
		});

		it("refuses a founding member on POST without creating a row", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createFoundingUser(harness);

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: NEW_TRIAL_END });

			expect(response.status).toBe(422);
			// The decisive assertion: still no row, so still a founding member.
			expect(await harness.subscriptionProviders.findByUserId(id)).toBeUndefined();
			expect(harness.trialScheduler.getSchedule(id)).toBeUndefined();
		});

		it("refuses a paid subscriber and leaves their Stripe ids intact", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);
			const id = await createFoundingUser(harness);
			await harness.subscriptionProviders.upsertActive({
				userId: id,
				subscriptionId: "sub_live_1",
				customerId: "cus_live_1",
			});

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: USER_EMAIL, trialEndsAt: NEW_TRIAL_END });

			expect(response.status).toBe(422);
			const row = await harness.subscriptionProviders.findByUserId(id);
			expect(row?.status).toBe("active");
			expect(row?.subscriptionId).toBe("sub_live_1");
			expect(row?.customerId).toBe("cus_live_1");
		});

		it("reports an unknown email on POST", async () => {
			const harness = buildHarness();
			const agent = await createAdmin(harness);

			const response = await agent
				.post("/admin/extend-trial")
				.type("form")
				.send({ email: "nobody@example.com", trialEndsAt: NEW_TRIAL_END });

			expect(response.status).toBe(422);
			const notFound = doc(response.text).querySelector("[data-test-extend-trial-not-found]");
			expect(notFound?.textContent?.trim()).toBe("No account with that email.");
		});
	});
});
