import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { HOME_B_CONTENT } from "./home-b.content";

const useApp = useTestServer();

function loadB(text: string): Document {
	return new JSDOM(text).window.document;
}

function attrs(doc: Document, selector: string, attr: string): string[] {
	return Array.from(doc.querySelectorAll(selector)).map((el) => el.getAttribute(attr) ?? "");
}

describe("GET /landing-b (arm B content)", () => {
	it("renders the sections in funnel order, top to bottom", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		expect(attrs(doc, "[data-test-section]", "data-test-section")).toEqual([
			"hb-hero",
			"hb-jobs",
			"hb-proof",
			"hb-price",
			"hb-limits",
			"hb-close",
		]);
	});

	it("puts three signup CTAs above, at, and after the offer, all one GET form with internal-click tracking", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		// hero primary, hero secondary (default = open reader), price, close.
		expect(attrs(doc, "[data-test-cta]", "data-test-cta")).toEqual([
			"hero",
			"hero-open-reader",
			"pricing",
			"close",
		]);

		const signupForms = Array.from(doc.querySelectorAll("[data-test-cta]"))
			.map((btn) => btn.closest("form"))
			.filter((form): form is HTMLFormElement => form?.getAttribute("action") === "/signup");
		expect(signupForms).toHaveLength(3);
		for (const form of signupForms) {
			expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
			const medium = form.querySelector('input[name="utm_medium"]')?.getAttribute("value");
			expect(medium).toBe("internal");
			expect(form.querySelector("button")?.textContent?.trim()).toBe(
				"Start your 14-day free trial",
			);
		}
	});

	it("states plainly what Readplace is and the value, for a cold visitor", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		const subhead = doc.querySelector(".hb-hero__subhead")?.textContent ?? "";
		expect(subhead).toContain("read-it-later app");
		expect(subhead).toContain("AI TL;DR");
	});

	it("renders one card per job, limit, and FAQ entry, driven by the content arrays", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		expect(doc.querySelectorAll("[data-test-hb-job]").length).toBe(
			HOME_B_CONTENT.jobs.items.length,
		);
		expect(doc.querySelectorAll(".hb-limits__item").length).toBe(HOME_B_CONTENT.limits.items.length);
		expect(doc.querySelectorAll("[data-test-hb-faq-question]").length).toBe(
			HOME_B_CONTENT.faq.length,
		);
	});

	it("is noindex with the canonical on / so it never competes with the indexed homepage", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, follow",
		);
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/",
		);
	});
});

describe("GET /landing-b arrival treatment", () => {
	it("greets a reader-view arrival and offers to save the article they just read", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/landing-b")
			.set("Cookie", ["hutch_lastview=https%3A%2F%2Fexample.com%2Farticle"]);
		const doc = loadB(response.text);

		assert(doc.querySelector("[data-test-hb-eyebrow]"), "arrival must show the reader eyebrow");
		expect(attrs(doc, "[data-test-cta]", "data-test-cta")).toContain("hero-save-last-view");

		const saveForm = doc
			.querySelector('[data-test-cta="hero-save-last-view"]')
			?.closest("form");
		assert(saveForm, "the save CTA must be a form");
		expect(saveForm.getAttribute("action")).toBe("/save");
		expect(saveForm.querySelector('input[name="url"]')?.getAttribute("value")).toBe(
			"https://example.com/article",
		);
	});

	it("shows no eyebrow and offers the paste-a-link reader form for a cold visitor", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/landing-b");
		const doc = loadB(response.text);

		expect(doc.querySelectorAll("[data-test-hb-eyebrow]").length).toBe(0);
		assert(
			doc.querySelector('[data-test-hb-input="hero-open-reader"]'),
			"the cold-visitor secondary must be the paste-a-link reader form",
		);
	});
});
