import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { ExtractLinksFromPageResult } from "@packages/extract-links-from-page";

function withExtractor(result: ExtractLinksFromPageResult) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.importSession.extractLinksFromPageUrl = async () => result;
	return fixture;
}

const useApp = useTestServer();

describe("POST /import/from-url routes", () => {
	describe("GET /import?mode=from-url", () => {
		it("renders the from-url panel with the from-url tab active", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const fromUrlTab = doc.querySelector('[data-test-import-tab="from-url"]');
			assert(fromUrlTab, "from-url tab anchor must be rendered");
			expect(fromUrlTab.getAttribute("aria-current")).toBe("page");
			const uploadTab = doc.querySelector('[data-test-import-tab="upload"]');
			assert(uploadTab, "upload tab anchor must be rendered");
			expect(uploadTab.getAttribute("aria-current")).toBe("false");
			const form = doc.querySelector('[data-test-form="import-from-url"]');
			assert(form, "from-url form must be rendered");
			expect(form.getAttribute("action")).toBe("/import/from-url");
			const input = form.querySelector('[data-test-import-from-url-input]');
			assert(input, "url input must be rendered");
			expect(input.getAttribute("type")).toBe("url");
			expect(input.getAttribute("name")).toBe("url");
		});

		it("prefills the url input and emits the auto-submit script for a from-url deep link", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(
				"/import?mode=from-url&url=https://news.ycombinator.com",
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const input = doc.querySelector("[data-test-import-from-url-input]");
			assert(input, "url input must be rendered");
			expect(input.getAttribute("value")).toBe("https://news.ycombinator.com");
			expect(response.text).toContain("form.requestSubmit()");
		});

		it("contains the prefilled url inside the input attribute without breaking out into markup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(
				`/import?mode=from-url&url=${encodeURIComponent('https://evil.example/"><script>alert(1)</script>')}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const injected = Array.from(doc.querySelectorAll("script")).some((s) =>
				s.textContent?.includes("alert(1)"),
			);
			assert(!injected, "the payload must not be parsed as a real <script> element");
			const input = doc.querySelector("[data-test-import-from-url-input]");
			assert(input, "url input must be rendered");
			expect(input.getAttribute("value")).toBe(
				'https://evil.example/"><script>alert(1)</script>',
			);
		});

		it("leaves the url input empty when no url param is supplied", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url");

			const doc = new JSDOM(response.text).window.document;
			const input = doc.querySelector("[data-test-import-from-url-input]");
			assert(input, "url input must be rendered");
			expect(input.getAttribute("value")).toBe("");
		});

		it("renders only the from-url form (no upload form) when mode=from-url", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=from-url");

			const doc = new JSDOM(response.text).window.document;
			const formIds = Array.from(doc.querySelectorAll("[data-test-form]")).map(
				(el) => el.getAttribute("data-test-form"),
			);
			expect(formIds).toEqual(["import-from-url"]);
		});

	});

	describe("POST /import/from-url (unauthenticated)", () => {
		it("creates an anonymous session from the harvested URLs and redirects to the review screen", async () => {
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
			const response = await request(harness.server)
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });
			expect(response.status).toBe(303);
			assert.match(
				response.headers.location,
				/^\/import\/[a-f0-9]{32}$/,
				"redirect must point at the new session",
			);

			const review = await request(harness.server).get(response.headers.location);
			expect(review.status).toBe(200);
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
				"/import?mode=from-url&error_code=import_url_invalid",
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
				"/import?mode=from-url&error_code=import_url_invalid",
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
				"/import?mode=from-url&error_code=import_url_fetch_failed",
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
				"/import?mode=from-url&error_code=import_url_fetch_failed",
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
				"/import?mode=from-url&error_code=import_url_fetch_failed",
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
				"/import?mode=from-url&error_code=import_url_too_large",
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
				"/import?mode=from-url&error_code=import_url_unsupported",
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
				"/import?mode=from-url&error_code=import_url_no_links",
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
				"/import?mode=from-url&error_code=import_url_invalid",
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

		it("emits import_from_url_acquired with is_authenticated=0 for an anonymous visitor", async () => {
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

			await request(harness.server)
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/42" });

			const events = harness.analytics.events.filter(
				(e) => e.event === "import_from_url_acquired",
			);
			assert.equal(events.length, 1, "exactly one import_from_url_acquired event");
			const event = events[0];
			assert(event.event === "import_from_url_acquired");
			assert.equal(event.is_authenticated, 0);
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

	describe("rate limiting", () => {
		it("returns 429 past the per-IP import-from-url limit without fetching the remote page", async () => {
			let fetches = 0;
			const fixture = withExtractor({
				status: "OK",
				links: { urls: ["https://example.com/a"], truncated: false, totalFound: 1 },
			});
			const baseExtractor = fixture.importSession.extractLinksFromPageUrl;
			fixture.importSession.extractLinksFromPageUrl = async (url) => {
				fetches += 1;
				return baseExtractor(url);
			};
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, importFromUrl: { limit: 1, windowSeconds: 3600 } },
			};
			const harness = useApp(fixture);

			const first = await request(harness.server).post("/import/from-url").type("form").send({ url: "https://example.com" });
			const throttled = await request(harness.server).post("/import/from-url").type("form").send({ url: "https://example.com" });

			expect(first.status).toBe(303);
			expect(throttled.status).toBe(429);
			expect(String(throttled.headers["retry-after"])).toMatch(/^\d+$/);
			expect(fetches).toBe(1);
		});
	});
});
