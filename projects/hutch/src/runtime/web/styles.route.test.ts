import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { findPageStylesheetByName } from "./page-stylesheets";

const useApp = useTestServer();

function queueStylesheet() {
	const stylesheet = findPageStylesheetByName("queue");
	assert(stylesheet, "the queue page must register its stylesheet at import time");
	return stylesheet;
}

describe("GET /styles/:file", () => {
	it("serves the registered stylesheet as immutable, long-lived text/css", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const stylesheet = queueStylesheet();

		const response = await request(harness.server).get(stylesheet.href);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/css; charset=utf-8");
		expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
		expect(response.text).toBe(stylesheet.css);
	});

	it("serves the current css even when the hash in the url is stale", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const stylesheet = queueStylesheet();

		const staleUrl = "/styles/queue.000000000000.css";
		assert.notEqual(staleUrl, stylesheet.href);
		const response = await request(harness.server).get(staleUrl);

		expect(response.status).toBe(200);
		expect(response.text).toBe(stylesheet.css);
	});

	it("404s an unknown stylesheet name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/styles/nonexistent.abc123def456.css");
		expect(response.status).toBe(404);
	});

	it("404s a filename that is not a hashed stylesheet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/styles/queue.css");
		expect(response.status).toBe(404);
	});

	it("references the exact served href from the queue page's <main>", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const stylesheet = queueStylesheet();
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const link = doc.querySelector('main link[rel="stylesheet"]');
		expect(link?.getAttribute("href")).toBe(stylesheet.href);
		expect(doc.querySelector("main style")).toBeNull();
	});
});
