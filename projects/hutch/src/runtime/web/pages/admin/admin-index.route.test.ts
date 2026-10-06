import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { UserIdSchema } from "@packages/domain/user";
import { initStarterReport } from "../../../domain/engagement/starter-report";
import type { StarterRollout } from "../../../domain/engagement/starter-policy";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";

const ROLLOUT: StarterRollout = {
	campaignId: "hn-starter-v1",
	observationStartedAt: "2026-10-07T12:00:00.000Z",
	enrollmentStartedAt: "2026-10-10T12:00:00.000Z",
	deploymentSha: "sha",
	excludedUserIds: [],
	treatmentPercent: 80,
	personalArticleLimit: 5,
	inactivityHours: 72,
	firstReviewDay: 42,
	reviewEnrollmentDays: 28,
};

const useApp = useTestServer();
const useReportApp = useTestServer({
	getStarterReport: initStarterReport({
		listAccounts: async () => [
			{
				userId: UserIdSchema.parse("trial-reader"),
				engagement: {
					activityRevision: 1,
					assignment: {
						campaignId: "hn-starter-v1",
						arm: "treatment",
						assignedAt: "2026-10-10T12:00:00.000Z",
						tier: "trial",
						accountCohort: "new",
					},
				},
			},
		],
		now: () => new Date("2026-11-21T12:00:00.000Z"),
		findRollout: async () => ROLLOUT,
	}),
});
const useComparedReportApp = useTestServer({
	getStarterReport: initStarterReport({
		listAccounts: async () =>
			(["treatment", "comparison"] as const).flatMap((arm) =>
				Array.from({ length: arm === "treatment" ? 70 : 80 }, (_, index) => ({
					userId: UserIdSchema.parse(`${arm}-${index}`),
					engagement: {
						activityRevision: 1,
						assignment: {
							campaignId: ROLLOUT.campaignId,
							arm,
							assignedAt: ROLLOUT.enrollmentStartedAt,
							tier: "trial" as const,
							accountCohort: "new" as const,
						},
						activatedAt:
							index < (arm === "treatment" ? 56 : 48) ? ROLLOUT.enrollmentStartedAt : undefined,
					},
				})),
			),
		now: () => new Date("2026-11-21T12:00:00.000Z"),
		findRollout: async () => ROLLOUT,
	}),
});

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
	it("shows the review with raw assigned denominators, cohorts and an inconclusive conclusion", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useReportApp({
			...fixture,
			admin: { ...fixture.admin, adminEmails: [ADMIN_EMAIL] },
		});
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = await loginAs({
			server: harness.server,
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});
		const response = await agent.get("/admin");
		const report = new JSDOM(response.text).window.document.querySelector(
			"[data-test-starter-report]",
		);
		assert(report);
		expect(report.textContent).toContain("inconclusive");
		expect(report.textContent).toContain("trial/new");
		expect(report.textContent).toContain("1 assigned");
		expect(report.textContent).toContain("95%");
	});
	it("shows the review's difference interval in percentage points", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useComparedReportApp({
			...fixture,
			admin: { ...fixture.admin, adminEmails: [ADMIN_EMAIL] },
		});
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = await loginAs({
			server: harness.server,
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});
		const document = new JSDOM((await agent.get("/admin")).text).window.document;
		expect(
			["low", "high"].map(
				(bound) =>
					document.querySelector(`[data-test-starter-difference-${bound}]`)?.textContent,
			),
		).toEqual(["5.24", "33.39"]);
	});
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
