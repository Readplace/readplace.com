import assert from "node:assert/strict";
import request from "supertest";
import { JSDOM } from "jsdom";
import { MAX_SUMMARY_LENGTH } from "save-link/generate-summary";
import { createTestApp } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

describe("GET /e2e/article/:id", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("returns 200 HTML for any :id", async () => {
		const response = await request(app).get("/e2e/article/12345-anon-view");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("returns the same body regardless of :id (uniqueness lives in the URL, not the content)", async () => {
		const a = await request(app).get("/e2e/article/run-a-slot-1");
		const b = await request(app).get("/e2e/article/run-b-slot-99");
		expect(a.text).toBe(b.text);
	});

	it("renders an <article> with an <h1> so Mozilla Readability can extract the body cleanly", async () => {
		const response = await request(app).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const article = doc.querySelector("article");
		assert(article, "<article> must be rendered");
		const h1 = article.querySelector("h1");
		expect(h1?.textContent).toBe("Readplace E2E test fixture article");
	});

	it("is marked noindex so search engines do not pick up the fixture URLs", async () => {
		const response = await request(app).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content");
		expect(robots).toBe("noindex, nofollow");
	});

	it("contains enough visible body text to clear the summariser's short-circuit threshold", async () => {
		const response = await request(app).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const article = doc.querySelector("article");
		const visibleLength = (article?.textContent ?? "").replace(/\s/g, "").length;
		// Summariser skips when visibleLength <= MAX_SUMMARY_LENGTH * 3 (see
		// save-link/src/runtime/generate-summary.main.ts isTooShortToSummarize).
		// The fixture must sit above that so staging exercises the real Deepseek
		// path, not the short-circuit branch.
		expect(visibleLength).toBeGreaterThan(MAX_SUMMARY_LENGTH * 3);
	});
});
