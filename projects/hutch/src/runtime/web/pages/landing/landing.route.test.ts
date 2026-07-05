import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const SPLIT_SCRIPT = "/client-dist/homepage-split.client.js";
const HOME_SCRIPT = "/client-dist/home.client.js";

const useApp = useTestServer();

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

describe.each([
	{ path: "/landing-a", variantClass: "variant-a" },
	{ path: "/landing-b", variantClass: "variant-b" },
])("GET $path (guest)", ({ path, variantClass }) => {
	it("returns 200 and HTML content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("tags the body with page-home and the variant marker", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		const doc = load(response.text);

		expect(doc.body.classList.contains("page-home")).toBe(true);
		expect(doc.body.classList.contains(variantClass)).toBe(true);
	});

	it("renders the homepage content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		const doc = load(response.text);

		const tagline = doc.querySelector("[data-test-tagline]");
		assert(tagline, "landing page must render the homepage tagline");
		expect(tagline.textContent?.trim()).toBe("Read the Web, not the Slop.");
	});

	it("is excluded from indexing so it never competes with / for SEO", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		const doc = load(response.text);

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, follow",
		);
	});

	it("keeps the canonical pointing at / so / stays the indexed page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		const doc = load(response.text);

		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/",
		);
	});

	it("does not load the split script, so it cannot redirect back into a loop", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);

		expect(response.text).not.toContain(SPLIT_SCRIPT);
	});

	it("still loads the home client bundle so the hero enhancements work", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);

		expect(response.text).toContain(HOME_SCRIPT);
	});
});

describe("GET /landing-a (authenticated)", () => {
	it("redirects a logged-in visitor straight to /queue, like /", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/landing-a");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});
