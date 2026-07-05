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
import { HOMEPAGE_SPLIT } from "./experiments/homepage-split";

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

	// The A/B-split launcher render of `/` is replaced client-side before it paints;
	// keeping its seen-script would record the version as seen and hide the NEW chip
	// on the arm the reader actually lands on. These three cases pin the boundary:
	// the launcher suppresses the script, the arms and the bot control keep it.
	it("suppresses the seen-script on the / launcher render for a human guest, keeping the banner visible", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => BANNER,
		});

		const response = await request(app).get("/");

		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		assert(banner, "changelog banner must render on the / launcher");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.getAttribute("data-changelog-version")).toBe(VERSION);
		assert(
			HOMEPAGE_SPLIT.active,
			"the launcher only suppresses the seen-script while the split is active; with the kill switch off, / stays put and keeps its seen-script",
		);
		expect(banner.querySelector("script")).toBeNull();
	});

	it("keeps the seen-script on the landing arms so the reader's real page records the first impression", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => BANNER,
		});

		for (const path of ["/landing-a", "/landing-b"]) {
			const response = await request(app).get(path);

			expect(response.status).toBe(200);
			const banner = new JSDOM(response.text).window.document.querySelector(
				"[data-test-changelog-banner]",
			);
			assert(banner, `changelog banner must render on ${path}`);
			expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
			expect(banner.querySelector("script")?.textContent).toBe(CHANGELOG_SEEN_SCRIPT);
		}
	});

	it("keeps the seen-script on / for a crawler, which stays on the control (no client redirect fires)", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getChangelogBanner: async () => BANNER,
		});

		const response = await request(app)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");

		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		assert(banner, "changelog banner must render on the control /");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.querySelector("script")?.textContent).toBe(CHANGELOG_SEEN_SCRIPT);
	});
});
