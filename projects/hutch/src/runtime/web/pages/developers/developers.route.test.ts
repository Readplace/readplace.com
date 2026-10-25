import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

function pageRoot(html: string): Element {
	const root = new JSDOM(html).window.document.querySelector("[data-test-developers]");
	assert(root, "the developers page root must render");
	return root;
}

describe("GET /developers", () => {
	it.each([
		["text/html", "text/html,application/xhtml+xml"],
		["*/*", "*/*"],
		["empty Accept", ""],
	])("serves the HTML page to a request that sends %s", async (_label, accept) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers").set("Accept", accept);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(pageRoot(response.text).querySelector("h1")?.textContent).toBe("Build on the Readplace API");
	});

	it("serves the HTML page when no Accept header is sent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(pageRoot(response.text).querySelector("h1")?.textContent).toBe("Build on the Readplace API");
	});

	it("renders one section per heading", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers");

		const sections = Array.from(pageRoot(response.text).querySelectorAll("[data-test-section]"), (section) =>
			section.getAttribute("data-test-section"),
		);
		expect(sections).toEqual(["discovery"]);
	});

	it("returns the page as Markdown with the sample as a fenced http block", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text.split("\n")[0]).toBe("# Build on the Readplace API — Readplace");
		expect(response.text).toContain(
			"```http\nGET / HTTP/1.1\nHost: readplace.com\nAuthorization: Bearer ACCESS_TOKEN\nAccept: application/vnd.siren+json\n```",
		);
		expect(response.text).not.toContain("<script");
	});
});
