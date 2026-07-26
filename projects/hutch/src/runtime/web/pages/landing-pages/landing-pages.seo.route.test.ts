import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { LANDING_PAGE_CONTENT } from "./landing-pages.content";
import type { LandingPageSlug } from "./landing-pages.content";

const SLUGS = Object.keys(LANDING_PAGE_CONTENT) as LandingPageSlug[];

const useApp = useTestServer();

async function loadPage(slug: LandingPageSlug) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get(`/${slug}`);
	return new JSDOM(response.text).window.document;
}

describe("landing page SEO", () => {
	it.each(SLUGS)("marks /%s indexable on its own canonical", async (slug) => {
		const doc = await loadPage(slug);
		const page = LANDING_PAGE_CONTENT[slug];

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"index, follow",
		);
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			`https://readplace.com/${slug}`,
		);
		expect(doc.title).toBe(page.title);
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
			page.description,
		);
		expect(doc.querySelector('meta[name="keywords"]')?.getAttribute("content")).toBe(
			page.keywords,
		);
	});

	/** These are paid-ads destinations. Without an image, a Meta or LinkedIn share
	 * of the URL renders as a bare text row that reads as broken. */
	it.each(SLUGS)("gives /%s a share card so a link preview is not blank", async (slug) => {
		const doc = await loadPage(slug);

		const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
		assert(ogImage, `${slug} must carry an og:image`);
		expect(ogImage).toMatch(/\/og-image-1200x630\.png$/);
		expect(doc.querySelector('meta[property="og:image:alt"]')?.getAttribute("content")).toBe(
			LANDING_PAGE_CONTENT[slug].ogImageAlt,
		);
		expect(
			doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
		).toMatch(/\/twitter-card-1200x600\.png$/);
	});

	it("describes each landing page's share card in its own words", async () => {
		const alts = SLUGS.map((slug) => LANDING_PAGE_CONTENT[slug].ogImageAlt);

		expect(new Set(alts).size).toBe(SLUGS.length);
	});

	it.each(SLUGS)("emits WebPage and FAQPage JSON-LD on /%s", async (slug) => {
		const doc = await loadPage(slug);

		const blocks = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? ""),
		);
		expect(blocks.map((block) => block["@type"])).toEqual(["WebPage", "FAQPage"]);

		const webPage = blocks[0];
		expect(webPage["@id"]).toBe(`https://readplace.com/${slug}`);
		expect(webPage.url).toBe(`https://readplace.com/${slug}`);
		expect(webPage.about["@id"]).toBe("https://readplace.com/#app");
		expect(webPage.name).toBe(LANDING_PAGE_CONTENT[slug].headline);
	});

	it.each(SLUGS)("keeps /%s FAQ structured data identical to the visible FAQ", async (slug) => {
		const doc = await loadPage(slug);

		const blocks = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? ""),
		);
		const jsonLdFaq = blocks[1].mainEntity.map(
			(entity: { name: string; acceptedAnswer: { text: string } }) => ({
				question: entity.name,
				answer: entity.acceptedAnswer.text,
			}),
		);

		const questions = Array.from(doc.querySelectorAll("[data-test-lp-faq-question]"));
		const answers = Array.from(doc.querySelectorAll("[data-test-lp-faq-answer]"));
		const onPageFaq = questions.map((question, i) => ({
			question: question.textContent,
			answer: answers[i].textContent,
		}));

		expect(onPageFaq.length).toBeGreaterThan(0);
		expect(jsonLdFaq).toEqual(onPageFaq);
	});

	it("gives each landing page a distinct title and description", async () => {
		const titles: string[] = [];
		const descriptions: string[] = [];

		for (const slug of SLUGS) {
			const doc = await loadPage(slug);
			const description = doc
				.querySelector('meta[name="description"]')
				?.getAttribute("content");
			assert(description, `${slug} must carry a meta description`);
			titles.push(doc.title);
			descriptions.push(description);
		}

		expect(new Set(titles).size).toBe(SLUGS.length);
		expect(new Set(descriptions).size).toBe(SLUGS.length);
	});

	it("lists every landing page in the sitemap so paid destinations also earn organic traffic", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");

		const sitemap = new JSDOM(response.text, { contentType: "text/xml" }).window.document;
		const locations = Array.from(sitemap.querySelectorAll("loc")).map((loc) => loc.textContent);

		for (const slug of SLUGS) {
			expect(locations).toContain(`${TEST_APP_ORIGIN}/${slug}`);
		}
	});
});
