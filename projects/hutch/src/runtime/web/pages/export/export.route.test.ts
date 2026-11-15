import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

function meteredExportFixture(params: { now: string; limit: number }) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const now = () => new Date(params.now);
	fixture.shared.now = now;
	fixture.rateLimit = { ...fixture.rateLimit,
		consumeRateLimit: initInMemoryRateLimit({ now }).consumeRateLimit,
		rules: { ...fixture.rateLimit.rules, export: { limit: params.limit, windowSeconds: 86_400 } },
	};
	const published: string[] = [];
	fixture.events.publishExportUserDataCommand = async (command) => {
		published.push(command.userId);
	};
	return { fixture, published };
}

async function signedInReader(harness: Harness, email: string) {
	await harness.auth.createUser({ email, password: "password123" });
	const user = await harness.auth.findUserByEmail(email);
	assert(user, "the reader must exist once created");
	const agent = request.agent(harness.server).set(BROWSER_REQUEST_HEADERS);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: user.userId };
}

function subscriptionRow(
	userId: UserId,
	overrides: Pick<SubscriptionRecord, "status"> & Partial<SubscriptionRecord>,
): SubscriptionRecord {
	return {
		userId,
		provider: "stripe",
		createdAt: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
		updatedAt: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
		...overrides,
	};
}

async function startExports(agent: ReturnType<typeof request.agent>, times: number) {
	const responses = [];
	for (let i = 0; i < times; i++) responses.push(await agent.post("/export/start"));
	return responses;
}

describe("Export routes", () => {
	describe("GET /export (unauthenticated)", () => {
		it("should redirect to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/export");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login?return=%2Fexport");
		});
	});

	describe("GET /export (authenticated)", () => {
		it("renders the landing page with a POST form pointing at /export/start", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/export");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Export your data");
			expect(doc.title).toBe("Export your data — Readplace");
			expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
				"Download a list of the articles you saved on Readplace.",
			);
			const button = doc.querySelector("[data-test-export-start]");
			expect(button?.tagName.toLowerCase()).toBe("button");
			const form = button?.closest("form");
			expect(form?.getAttribute("action")).toBe("/export/start?utm_source=export&utm_medium=internal&utm_content=start");
			expect(form?.getAttribute("method")?.toUpperCase()).toBe("POST");
		});

		it("lists highlights and notes in what's included and says when they are deleted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/export");

			const doc = new JSDOM(response.text).window.document;
			const items = Array.from(doc.querySelectorAll(".export__list-item"), (item) => item.textContent);
			expect(items).toContain("Highlights and notes, with the passage and your note");
			expect(doc.body.textContent).toContain("Highlights and notes are deleted with the article, and with your account.");
		});

		it("renders a 'preparing' confirmation when ?status=preparing is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/export?status=preparing");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-export-preparing]")).not.toBeNull();
			expect(doc.querySelector("h1")?.textContent).toBe("Preparing your export");
		});
	});

	describe("POST /export/start (unauthenticated)", () => {
		it("should redirect to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).post("/export/start");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login?return=%2Fexport%2Fstart");
		});
	});

	describe("POST /export/start (authenticated)", () => {
		it("publishes ExportUserDataCommand carrying userId and requestedAt and redirects to the preparing page", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const published: Array<{
				userId: string;
				requestedAt: string;
			}> = [];
			fixture.events.publishExportUserDataCommand = async (params) => {
				published.push(params);
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/export/start");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/export?status=preparing");
			const user = await harness.auth.findUserByEmail("test@example.com");
			assert(user, "the logged-in user must exist");
			expect(published).toEqual([{ userId: user.userId, requestedAt: expect.any(String) }]);
			expect(Number.isFinite(new Date(published[0].requestedAt).getTime())).toBe(true);
		});

		it("lets a metered account request 3 exports a day and answers the 4th with the limit page", async () => {
			const { fixture, published } = meteredExportFixture({ now: "2026-11-13T21:30:00.000Z", limit: 3 });
			const harness = useApp(fixture);
			const { agent, userId } = await signedInReader(harness, "export-metered@example.com");
			harness.subscriptionProviders.seedRow(subscriptionRow(userId, { status: "cancelled" }));

			const responses = await startExports(agent, 4);

			expect(responses.slice(0, 3).map((r) => [r.status, r.headers.location])).toEqual([
				[303, "/export?status=preparing"],
				[303, "/export?status=preparing"],
				[303, "/export?status=preparing"],
			]);
			const refused = responses[3];
			expect(refused.status).toBe(429);
			expect(refused.headers["retry-after"]).toBe("9000");
			expect(published).toEqual([userId, userId, userId]);
			const doc = new JSDOM(refused.text).window.document;
			const main = doc.querySelector("[data-test-export-limit-reached]");
			assert(main, "the limit page must render");
			expect(doc.querySelector("h1")?.textContent).toBe("Export limit reached");
			expect(main.textContent).toContain("You can request up to 3 exports a day.");
			expect(main.textContent).toContain("You can request another export in about 3 hours.");
			expect(main.textContent).toContain("The download link in your latest export email stays valid for 7 days.");
			expect(doc.querySelector("[data-test-export-start]")).toBeNull();
		});

		it("never meters a founding account's exports", async () => {
			const { fixture, published } = meteredExportFixture({ now: "2026-11-13T21:30:00.000Z", limit: 3 });
			const harness = useApp(fixture);
			const { agent } = await signedInReader(harness, "export-founding@example.com");

			const responses = await startExports(agent, 4);

			expect(responses.map((r) => r.status)).toEqual([303, 303, 303, 303]);
			expect(published).toHaveLength(4);
		});

		it("never meters an account inside its trial", async () => {
			const { fixture, published } = meteredExportFixture({ now: "2026-11-13T21:30:00.000Z", limit: 3 });
			const harness = useApp(fixture);
			const { agent, userId } = await signedInReader(harness, "export-trial@example.com");
			harness.subscriptionProviders.seedRow(
				subscriptionRow(userId, { status: "trialing", trialEndsAt: "2026-11-20T00:00:00.000Z" }),
			);

			const responses = await startExports(agent, 4);

			expect(responses.map((r) => r.status)).toEqual([303, 303, 303, 303]);
			expect(published).toHaveLength(4);
		});

		it("meters an account whose trial has ended", async () => {
			const { fixture, published } = meteredExportFixture({ now: "2026-11-13T21:30:00.000Z", limit: 3 });
			const harness = useApp(fixture);
			const { agent, userId } = await signedInReader(harness, "export-trial-ended@example.com");
			harness.subscriptionProviders.seedRow(
				subscriptionRow(userId, { status: "trialing", trialEndsAt: "2026-11-10T00:00:00.000Z" }),
			);

			const responses = await startExports(agent, 4);

			expect(responses.map((r) => r.status)).toEqual([303, 303, 303, 429]);
			expect(published).toHaveLength(3);
		});

		it("counts each account's exports on its own", async () => {
			const { fixture, published } = meteredExportFixture({ now: "2026-11-13T21:30:00.000Z", limit: 3 });
			const harness = useApp(fixture);
			const a = await signedInReader(harness, "export-a@example.com");
			const b = await signedInReader(harness, "export-b@example.com");
			harness.subscriptionProviders.seedRow(subscriptionRow(a.userId, { status: "cancelled" }));
			harness.subscriptionProviders.seedRow(subscriptionRow(b.userId, { status: "cancelled" }));
			await startExports(a.agent, 4);

			const response = await b.agent.post("/export/start");

			expect(response.status).toBe(303);
			expect(published).toEqual([a.userId, a.userId, a.userId, b.userId]);
		});

		it("names a limit of one export and a retry under an hour in the singular", async () => {
			const { fixture } = meteredExportFixture({ now: "2026-11-13T23:30:00.000Z", limit: 1 });
			const harness = useApp(fixture);
			const { agent, userId } = await signedInReader(harness, "export-singular@example.com");
			harness.subscriptionProviders.seedRow(subscriptionRow(userId, { status: "cancelled" }));

			const [, refused] = await startExports(agent, 2);

			expect(refused.status).toBe(429);
			expect(refused.headers["retry-after"]).toBe("1800");
			const main = new JSDOM(refused.text).window.document.querySelector("[data-test-export-limit-reached]");
			assert(main, "the limit page must render");
			expect(main.textContent).toContain("You can request up to 1 export a day.");
			expect(main.textContent).toContain("You can request another export in about 1 hour.");
		});
	});
});
