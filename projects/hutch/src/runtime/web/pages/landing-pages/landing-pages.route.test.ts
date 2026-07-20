import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { LANDING_PAGE_CONTENT } from "./landing-pages.content";
import type { LandingPageSlug } from "./landing-pages.content";

const SLUGS = Object.keys(LANDING_PAGE_CONTENT) as LandingPageSlug[];

const SECTIONS = [
	"lp-hero",
	"lp-how-it-works",
	"lp-mechanism",
	"lp-limits",
	"lp-faq",
	"lp-close",
];

const useApp = useTestServer();

async function loadPage(slug: LandingPageSlug) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get(`/${slug}`);
	return { response, doc: new JSDOM(response.text).window.document };
}

describe("landing pages", () => {
	it.each(SLUGS)("serves /%s as HTML", async (slug) => {
		const { response } = await loadPage(slug);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it.each(SLUGS)("renders every section on /%s", async (slug) => {
		const { doc } = await loadPage(slug);

		const rendered = Array.from(doc.querySelectorAll("[data-test-section]")).map((section) =>
			section.getAttribute("data-test-section"),
		);
		expect(rendered).toEqual(SECTIONS);
	});

	it.each(SLUGS)("states what /%s does not do, because the brand requires it", async (slug) => {
		const { doc } = await loadPage(slug);

		const limits = Array.from(doc.querySelectorAll(".lp-limits__item")).map(
			(item) => item.textContent,
		);
		expect(limits).toEqual([...LANDING_PAGE_CONTENT[slug].limits]);
	});

	it.each(SLUGS)("stamps internal-click attribution on every /%s call to action", async (slug) => {
		const { doc } = await loadPage(slug);

		const forms = Array.from(doc.querySelectorAll("form.lp-action"));
		expect(forms.length).toBeGreaterThan(0);

		for (const form of forms) {
			const params = new Map(
				Array.from(form.querySelectorAll("input[type=hidden]")).map((input) => [
					input.getAttribute("name"),
					input.getAttribute("value"),
				]),
			);
			expect(params.get("utm_medium")).toBe("internal");
			expect(params.get("utm_source")).toMatch(new RegExp(`^lp-${slug}-(hero|close)$`));
			/** A GET submit discards the action's query string, so attribution
			 * only survives as hidden inputs — the action must stay a bare path. */
			expect(form.getAttribute("action")).toMatch(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);
		}
	});

	it("sends each page's primary action to the destination that matches its advantage", async () => {
		const destinations: Record<LandingPageSlug, string> = {
			"pocket-alternative": "/import",
			"pdf-ocr": "/view",
			"ai-reading-list": "/mcp",
			"read-it-later-that-wont-die": "/signup",
		};

		for (const slug of SLUGS) {
			const { doc } = await loadPage(slug);
			const hero = doc.querySelector('[data-test-section="lp-hero"] form.lp-action');
			assert(hero, `${slug} must render a hero action`);
			expect(hero.getAttribute("action")).toBe(destinations[slug]);
		}
	});

	it("gives only the PDF page a paste field, and labels it for screen readers", async () => {
		const fieldsBySlug: Record<string, string[]> = {};
		for (const slug of SLUGS) {
			const { doc } = await loadPage(slug);
			fieldsBySlug[slug] = Array.from(doc.querySelectorAll("[data-test-lp-input]")).map(
				(input) => input.getAttribute("data-test-lp-input") ?? "",
			);
		}

		expect(fieldsBySlug).toEqual({
			"pocket-alternative": [],
			"pdf-ocr": ["try-pdf", "close-try-pdf"],
			"ai-reading-list": [],
			"read-it-later-that-wont-die": [],
		});

		const { doc } = await loadPage("pdf-ocr");
		for (const input of Array.from(doc.querySelectorAll("[data-test-lp-input]"))) {
			const id = input.getAttribute("id");
			assert(id, "a paste field must carry an id its label can point at");
			const label = doc.querySelector(`label[for="${id}"]`);
			assert(label, `field ${id} must have a label`);
			expect(label.textContent).toBe("Link to a PDF or article");
			expect(input.getAttribute("name")).toBe("url");
		}
	});

	it("gives the PDF paste field a submit target /view can resolve", async () => {
		const { doc } = await loadPage("pdf-ocr");

		const form = doc.querySelector('[data-test-section="lp-hero"] form.lp-action');
		assert(form, "pdf-ocr must render a hero form");
		expect(form.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(form.getAttribute("action")).toBe("/view");
	});

	it("numbers the how-it-works steps from one", async () => {
		const { doc } = await loadPage("pocket-alternative");

		const ordinals = Array.from(doc.querySelectorAll(".lp-steps__ordinal")).map(
			(step) => step.textContent,
		);
		expect(ordinals).toEqual(["1", "2", "3"]);
	});

	it("keeps a single h1 per page for the document outline", async () => {
		for (const slug of SLUGS) {
			const { doc } = await loadPage(slug);
			const headings = Array.from(doc.querySelectorAll("main h1")).map((h) => h.textContent);
			expect(headings).toHaveLength(1);
		}
	});

	/** No LICENSE file exists at the repo root, so "open source" is a claim the
	 * repo cannot support. The permanence page raises the distinction rather
	 * than staying silent on it. */
	it("calls the project source-available and answers the open-source question directly", async () => {
		const { doc } = await loadPage("read-it-later-that-wont-die");

		const answers = Array.from(doc.querySelectorAll("[data-test-lp-faq-answer]")).map(
			(answer) => answer.textContent,
		);
		expect(answers).toContain(
			"No. It is source-available: the code is on GitHub to read, but no licence grants rights to reuse it.",
		);

		const limits = Array.from(doc.querySelectorAll(".lp-limits__item")).map(
			(item) => item.textContent,
		);
		expect(limits).toContain(
			"Source-available is not open source. The code is on GitHub to read, but no licence grants you rights to reuse it.",
		);
	});
});
