import assert from "node:assert/strict";
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
	});
});
