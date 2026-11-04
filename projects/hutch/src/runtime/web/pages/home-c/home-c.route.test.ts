import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { PRICING_PLANS } from "@packages/web-shell";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { SAVES_STAY_STATEMENT } from "../../price-statement";

const useArmB = useTestServer({ drawRandomByte: () => 0 });
const useArmC = useTestServer({ drawRandomByte: () => 255 });

async function loadArm(harness: ReturnType<typeof useArmC>, cookie?: string) {
	const pending = request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);
	const response = await (cookie === undefined ? pending : pending.set("Cookie", cookie));
	return { response, doc: new JSDOM(response.text).window.document };
}

describe("GET / arm C", () => {
	it("leads with what Readplace keeps, and states the price and what happens to saves in the hero", async () => {
		const { doc } = await loadArm(useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

		assert(doc.querySelector("body.page-home.variant-c"), "the draw must serve arm C");
		expect(doc.querySelector("h1[data-test-tagline]")?.textContent).toBe(
			"One place to keep the articles you want to come back to.",
		);
		expect(doc.querySelector(".home-hero__subhead")?.textContent).toBe(
			"Save from your browser or your iPhone. Read when you have time. 14 days free, no card; then $60 a year or $10 a month.",
		);
		expect(doc.querySelector(".home-hero [data-test-saves-stay]")?.textContent).toBe(SAVES_STAY_STATEMENT);
	});

	it("offers no 3-year plan, so the page states one price", async () => {
		const { response } = await loadArm(useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

		expect(response.text).not.toContain(PRICING_PLANS.triennial.monthlyDisplay);
	});

	it("keeps arm B's paste box as the hero's action", async () => {
		const { doc } = await loadArm(useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

		const form = doc.querySelector('[data-test-hero-form="homepage-link-input"]');
		assert(form, "the paste box must be rendered");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/view");
		expect(form.querySelector('[data-test-cta="homepage-link-input"]')?.textContent?.trim()).toBe("Open in reader view");
		expect(doc.querySelector(".home-hero__reassurance")?.textContent).toBe("Free. No account. Articles and PDFs.");
	});

	it("lists what happens to what you keep, linking the EPUB tool with its tracking", async () => {
		const { doc } = await loadArm(useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

		const section = doc.querySelector('[data-test-section="capabilities"]');
		assert(section, "arm C must render its capabilities section");
		expect(section.getAttribute("aria-label")).toBe("What Readplace does with what you keep");
		expect(section.querySelector("h2")?.textContent?.trim()).toBe("What happens to what you keep");
		expect(Array.from(section.querySelectorAll("[data-test-capability]"), (item) => item.getAttribute("data-test-capability")))
			.toEqual(["clean-reading", "summaries", "epub"]);
		expect(section.querySelector('[data-test-capability="epub"] a')?.getAttribute("href")).toBe(
			"/article-to-epub?utm_source=home-capabilities&utm_medium=internal&utm_content=article-to-epub",
		);
	});

	it("offers the article just read first, as arm B does", async () => {
		const { doc } = await loadArm(
			useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)),
			`hutch_lastview=${encodeURIComponent("https://example.com/article")}`,
		);

		expect(Array.from(doc.querySelectorAll("[data-test-hero-form]"), (form) => form.getAttribute("data-test-hero-form")))
			.toEqual(["hero-save-last-view", "homepage-link-input"]);
	});

	it("keeps the canonical and the title arm B carries", async () => {
		const armC = await loadArm(useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN)));
		const armB = await loadArm(useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

		expect(armC.doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://readplace.com/");
		expect(armC.doc.title).toBe(armB.doc.title);
		assert(armB.doc.querySelector("body.page-home.variant-b"), "the draw must serve arm B");
	});
});
