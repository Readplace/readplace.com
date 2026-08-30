import assert from "node:assert/strict";
import request from "supertest";
import { JSDOM } from "jsdom";
import { MAX_SUMMARY_LENGTH } from "@packages/provider-contracts/article-summary";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

/** The CSP nonce is minted per request, so two responses are never byte-identical.
 * Blank it out to compare what the route actually controls: the rendered content. */
function withoutCspNonces(html: string): string {
	return html.replace(/ nonce="[^"]*"/g, ' nonce=""');
}

describe("GET /e2e/article/:id", () => {
	it("returns 200 HTML for any :id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/e2e/article/12345-anon-view");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("returns the same body regardless of :id (uniqueness lives in the URL, not the content)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const a = await request(harness.server).get("/e2e/article/run-a-slot-1");
		const b = await request(harness.server).get("/e2e/article/run-b-slot-99");
		expect(withoutCspNonces(a.text)).toBe(withoutCspNonces(b.text));
	});

	it("renders an <article> with an <h1> so Mozilla Readability can extract the body cleanly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const article = doc.querySelector("article");
		assert(article, "<article> must be rendered");
		const h1 = article.querySelector("h1");
		expect(h1?.textContent).toBe("Readplace E2E test fixture article");
	});

	it("uses the title query param as the article <h1> and document <title> so one run can save distinct fixtures", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			"/e2e/article/slot-1?title=Custom%20Fixture%20Title",
		);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("article h1")?.textContent).toBe("Custom Fixture Title");
		expect(doc.title).toBe("Custom Fixture Title");
	});

	it("is marked noindex so search engines do not pick up the fixture URLs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content");
		expect(robots).toBe("noindex, nofollow");
	});

	it("contains enough visible body text to clear the summariser's short-circuit threshold", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/e2e/article/x");
		const doc = new JSDOM(response.text).window.document;
		const article = doc.querySelector("article");
		const visibleLength = (article?.textContent ?? "").replace(/\s/g, "").length;
		// The fixture must sit above the summariser's short-circuit threshold so
		// staging exercises the real summarisation path, not the short-circuit branch.
		expect(visibleLength).toBeGreaterThan(MAX_SUMMARY_LENGTH * 3);
	});
});

describe("GET /e2e/fixtures/unfetchable/:id", () => {
	it("answers 404 text/plain, a status the crawl pipeline settles as failed in-process rather than retrying", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get(
			"/e2e/fixtures/unfetchable/run-a-crawl-fails",
		);

		expect(response.status).toBe(404);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
	});

	it("answers the same for any :id (uniqueness lives in the path, not the body)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get(
			"/e2e/fixtures/unfetchable/run-b-banner-on-public-view",
		);

		expect(response.status).toBe(404);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
	});
});
