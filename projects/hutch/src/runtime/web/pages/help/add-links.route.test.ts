import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /help/add-links", () => {
	it("renders the Share instructions as HTML for a logged-out visitor", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-title]")?.textContent).toBe(
			"Add links with Share",
		);
		const steps = Array.from(
			doc.querySelectorAll("[data-test-help-step]"),
		).map((el) => el.textContent?.trim());
		expect(steps).toEqual([
			"Open a link in any app.",
			"Tap Share.",
			"Choose Readplace.",
		]);
		expect(doc.querySelector("[data-test-help-note]")?.textContent).toContain(
			"captures the full page",
		);
	});

	it("falls through to HTML when text/markdown is requested", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server)
			.get("/help/add-links")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});
});
