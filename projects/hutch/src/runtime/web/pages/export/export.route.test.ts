import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("Export routes", () => {
	describe("GET /export (unauthenticated)", () => {
		it("should redirect to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/export");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("GET /export (authenticated)", () => {
		it("renders the landing page with a POST form pointing at /export/start", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/export");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toContain(
				"Export Your Data",
			);
			const button = doc.querySelector("[data-test-export-start]");
			expect(button?.tagName.toLowerCase()).toBe("button");
			const form = button?.closest("form");
			expect(form?.getAttribute("action")).toBe("/export/start");
			expect(form?.getAttribute("method")?.toUpperCase()).toBe("POST");
		});

		it("renders a 'preparing' confirmation when ?status=preparing is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/export?status=preparing");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-export-preparing]")).not.toBeNull();
			expect(doc.querySelector("h1")?.textContent).toContain(
				"preparing your export",
			);
		});
	});

	describe("POST /export/start (unauthenticated)", () => {
		it("should redirect to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).post("/export/start");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("POST /export/start (authenticated)", () => {
		it("logs and redirects back to /export when the user's email cannot be looked up", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const errorMessages: string[] = [];
			fixture.shared.logError = (msg) => { errorMessages.push(msg); };
			fixture.auth.findEmailByUserId = async () => null;
			let published = 0;
			fixture.events.publishExportUserDataCommand = async () => { published++; };
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/export/start");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/export");
			expect(published).toBe(0);
			expect(errorMessages.some((m) => m.includes("No email found for userId"))).toBe(true);
		});

		it("publishes ExportUserDataCommand carrying userId + email and redirects to the preparing page", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const published: Array<{
				userId: string;
				email: string;
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
			expect(published).toHaveLength(1);
			expect(published[0].email).toBe("test@example.com");
			expect(published[0].userId).toMatch(/.+/);
			expect(Number.isFinite(new Date(published[0].requestedAt).getTime())).toBe(true);
		});
	});
});
