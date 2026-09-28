import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../test-app";

function bannerFetchUrl(html: string): URL {
	const banner = new JSDOM(html).window.document.querySelector(".banner-area [data-test-changelog-banner]");
	expect(banner?.classList.contains("changelog-banner--hidden")).toBe(true);
	return new URL(String(banner?.getAttribute("hx-get")), TEST_APP_ORIGIN);
}

describe("changelog banner on hutch pages", () => {
	it("leaves the banner for the browser to fetch from the blog, returning to the page it is shown on", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(app).get("/privacy");

		expect(response.status).toBe(200);
		const url = bannerFetchUrl(response.text);
		expect(url.pathname).toBe("/blog/changelog-banner");
		expect(url.searchParams.get("returnTo")).toBe("/privacy");
	});

	it.each([
		["a human guest", undefined],
		["a crawler", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
	])("leaves the banner for the browser to fetch on / for %s", async (_who, userAgent) => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const pending = request(app).get("/");
		const response = await (userAgent === undefined ? pending : pending.set("User-Agent", userAgent));

		expect(response.status).toBe(200);
		expect(bannerFetchUrl(response.text).pathname).toBe("/blog/changelog-banner");
	});
});
