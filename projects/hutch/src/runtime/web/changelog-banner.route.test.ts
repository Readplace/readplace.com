import assert from "node:assert/strict";
import {
	CHANGELOG_SEEN_SCRIPT,
	type ChangelogBanner,
	isChangelogVersion,
} from "@packages/web-shell";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../test-app";

const VERSION = "a1b2c3d4";
assert(isChangelogVersion(VERSION));
const BANNER: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: VERSION,
};

describe("changelog banner on hutch pages", () => {
	it("renders the visible banner in the banner area for a guest when the source has one", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => BANNER,
		});

		const response = await request(app).get("/privacy");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const bannerArea = doc.querySelector(".banner-area");
		const banner = bannerArea?.querySelector("[data-test-changelog-banner]");
		expect(banner?.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner?.querySelector(".changelog-banner__hook")?.textContent).toBe(BANNER.hook);
		expect(banner?.querySelector(".changelog-banner__link")?.getAttribute("href")).toBe(
			BANNER.href,
		);
		expect(banner?.getAttribute("data-changelog-version")).toBe(VERSION);
		expect(banner?.querySelector("script")?.textContent).toBe(CHANGELOG_SEEN_SCRIPT);
	});

	it("renders the hidden shell when the source has nothing to announce", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(app).get("/privacy");

		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	// `/` is the page the reader keeps — whichever homepage arm it renders — so it
	// records the version as seen on the impression the reader actually got, and
	// the one-shot NEW chip self-suppresses on their next visit.
	it.each([
		["a human guest", undefined],
		["a crawler", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
	])("records the banner as seen on / for %s", async (_who, userAgent) => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => BANNER,
		});

		const pending = request(app).get("/");
		const response = await (userAgent === undefined ? pending : pending.set("User-Agent", userAgent));

		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		assert(banner, "changelog banner must render on /");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.getAttribute("data-changelog-version")).toBe(VERSION);
		expect(banner.querySelector("script")?.textContent).toBe(CHANGELOG_SEEN_SCRIPT);
	});

	it("consults the changelog source once via the pre-auth kick on a redirect that never renders the shell", async () => {
		let consultations = 0;
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => {
				consultations++;
				return undefined;
			},
		});

		const response = await request(app).get("/queue/counts");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
		expect(consultations).toBe(1);
	});
});
