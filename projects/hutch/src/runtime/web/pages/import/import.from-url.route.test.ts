import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import type { ExtractLinksFromPageResult } from "@packages/extract-links-from-page";

function withExtractor(result: ExtractLinksFromPageResult) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.importSession.extractLinksFromPageUrl = async () => result;
	return fixture;
}

const useApp = useTestServer();

describe("POST /import/from-url routes", () => {
	describe("GET /import?mode=from-url&feature=import-link-public", () => {
		it("renders the from-url panel with the from-url tab active", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url&feature=import-link-public");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const fromUrlTab = doc.querySelector('[data-test-import-tab="from-url"]');
			assert(fromUrlTab, "from-url tab anchor must be rendered");
			expect(fromUrlTab.getAttribute("aria-current")).toBe("page");
			const uploadTab = doc.querySelector('[data-test-import-tab="upload"]');
			assert(uploadTab, "upload tab anchor must be rendered");
			expect(uploadTab.getAttribute("aria-current")).toBeNull();
			const form = doc.querySelector('[data-test-form="import-from-url"]');
			assert(form, "from-url form must be rendered");
			expect(form.getAttribute("action")).toBe("/import/from-url");
			const input = form.querySelector('[data-test-import-from-url-input]');
			assert(input, "url input must be rendered");
			expect(input.getAttribute("type")).toBe("url");
			expect(input.getAttribute("name")).toBe("url");
		});

		it("does not render the upload form when mode=from-url", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url&feature=import-link-public");

			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="import-file"]')).toBeNull();
		});

		it("does not render the from-url tab without the feature flag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url");

			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-import-tab="from-url"]')).toBeNull();
			const form = doc.querySelector('[data-test-form="import-file"]');
			assert(form, "falls back to upload form without feature flag");
		});
	});

	describe("POST /import/from-url (unauthenticated)", () => {
		it("redirects to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("POST /import/from-url (authenticated)", () => {
		it("creates a session from the harvested URLs and redirects to the review screen", async () => {
			const harness = useApp(
				withExtractor({
					status: "OK",
					links: {
						urls: ["https://example.com/a", "https://example.com/b"],
						truncated: false,
						totalFound: 2,
					},
				}),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			assert.match(
				response.headers.location,
				/^\/import\/[a-f0-9]{32}$/,
				"redirect must point at the new session",
			);

			const review = await agent.get(response.headers.location);
			const doc = new JSDOM(review.text).window.document;
			const urls = Array.from(doc.querySelectorAll("[data-test-import-url]"))
				.map((el) => el.textContent)
				.sort();
			expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
		});

		it("redirects with import_url_invalid for a missing url body", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/import/from-url").type("form").send({});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_invalid",
			);
		});

		it("redirects with import_url_invalid when the extractor reports INVALID_URL", async () => {
			const harness = useApp(withExtractor({ status: "INVALID_URL" }));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "http://localhost/secret" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_invalid",
			);
		});

		it("redirects with import_url_fetch_failed when the fetch returns http 500", async () => {
			const harness = useApp(
				withExtractor({ status: "FETCH_FAILED", reason: "http", httpStatus: 500 }),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_fetch_failed",
			);
		});

		it("redirects with import_url_fetch_failed on timeout", async () => {
			const harness = useApp(withExtractor({ status: "FETCH_FAILED", reason: "timeout" }));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_fetch_failed",
			);
		});

		it("redirects with import_url_fetch_failed on network error", async () => {
			const harness = useApp(withExtractor({ status: "FETCH_FAILED", reason: "network" }));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_fetch_failed",
			);
		});

		it("redirects with import_url_too_large when the page exceeds the size cap", async () => {
			const harness = useApp(withExtractor({ status: "FETCH_FAILED", reason: "too_large" }));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_too_large",
			);
		});

		it("redirects with import_url_unsupported for non-HTML content-types", async () => {
			const harness = useApp(
				withExtractor({ status: "UNSUPPORTED_CONTENT_TYPE", contentType: "application/pdf" }),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42.pdf" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_unsupported",
			);
		});

		it("redirects with import_url_no_links when the harvested list is empty", async () => {
			const harness = useApp(
				withExtractor({
					status: "OK",
					links: { urls: [], truncated: false, totalFound: 0 },
				}),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_no_links",
			);
		});

		it("trims surrounding whitespace before validating the url", async () => {
			const harness = useApp(
				withExtractor({
					status: "OK",
					links: { urls: ["https://example.com/a"], truncated: false, totalFound: 1 },
				}),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "  https://news.example/  " });

			expect(response.status).toBe(303);
			assert.match(response.headers.location, /^\/import\/[a-f0-9]{32}$/);
		});

		it("renders the error message on the from-url panel after redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(
				"/import?mode=from-url&feature=import-link-public&error_code=import_url_invalid",
			);

			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered");
			expect(error.textContent).toContain("private-network");
		});
	});

	describe("Analytics events", () => {
		it("emits import_from_url_acquired with url_count on success", async () => {
			const harness = useApp(
				withExtractor({
					status: "OK",
					links: {
						urls: ["https://example.com/a", "https://example.com/b"],
						truncated: false,
						totalFound: 2,
					},
				}),
			);
			const agent = await loginAgent(harness.server, harness.auth);

			await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			const events = harness.analytics.events.filter(
				(e) => e.event === "import_from_url_acquired",
			);
			assert.equal(events.length, 1, "exactly one import_from_url_acquired event");
			const event = events[0];
			assert(event.event === "import_from_url_acquired");
			assert.equal(event.url_count, 2);
			assert.equal(event.utm_source, "import-feature");
			assert.equal(event.utm_medium, "form");
			assert.equal(event.utm_campaign, "from-url");
			assert.equal(event.is_authenticated, 1);
		});

		it("does not emit import_from_url_acquired on failure paths", async () => {
			const harness = useApp(withExtractor({ status: "INVALID_URL" }));
			const agent = await loginAgent(harness.server, harness.auth);

			await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "http://localhost/" });

			await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "" });

			const events = harness.analytics.events.filter(
				(e) => e.event === "import_from_url_acquired",
			);
			assert.equal(events.length, 0);
		});
	});
});
