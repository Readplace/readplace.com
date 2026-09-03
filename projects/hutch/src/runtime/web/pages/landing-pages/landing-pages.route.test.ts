import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { CHEAPEST_MONTHLY_DISPLAY } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { ADVERTISED_CLIENTS, UNADVERTISED_CLIENTS } from "@packages/supported-clients";
import { LANDING_PAGE_CONTENT } from "./landing-pages.content";
import type { LandingPageSlug } from "./landing-pages.types";

const SLUGS = Object.keys(LANDING_PAGE_CONTENT) as LandingPageSlug[];

const SECTIONS = [
	"lp-hero",
	"lp-how-it-works",
	"lp-proof",
	"lp-mechanism",
	"lp-limits",
	"lp-faq",
	"lp-offer",
	"lp-close",
];

const useApp = useTestServer();

async function loadPage(slug: LandingPageSlug) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get(`/${slug}`);
	return { response, doc: new JSDOM(response.text).window.document };
}

describe("landing pages", () => {
	it("names every advertised assistant on /ai-reading-list, and no unadvertised one", async () => {
		const { response } = await loadPage("ai-reading-list");

		for (const client of ADVERTISED_CLIENTS) {
			if (client.group !== "aiAssistant") continue;
			expect(response.text).toContain(client.displayName);
		}
		for (const client of UNADVERTISED_CLIENTS) {
			expect(response.text).not.toContain(client.displayName);
		}
	});


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

	/** Three of the four destinations eventually ask for a subscription. A reader
	 * who arrives from a paid ad and only discovers the price at the checkout was
	 * misled by the page, so every page names it — from the pricing constants, so
	 * the copy cannot drift away from what the card is charged. */
	it.each(SLUGS)("names the price and the trial on /%s before the closing CTA", async (slug) => {
		const { doc } = await loadPage(slug);

		const offer = doc.querySelector('[data-test-section="lp-offer"]');
		assert(offer, `${slug} must state its offer`);
		expect(offer.textContent).toContain(`${CHEAPEST_MONTHLY_DISPLAY}/month`);
		expect(offer.textContent).toContain(String(STRIPE_TRIAL_PERIOD_DAYS));
	});

	it.each(SLUGS)("shows the product on /%s rather than only describing it", async (slug) => {
		const { doc } = await loadPage(slug);
		const proof = doc.querySelector('[data-test-section="lp-proof"]');
		assert(proof, `${slug} must render a proof section`);

		const image = proof.querySelector("img");
		if (image) {
			expect(image.getAttribute("loading")).toBe("lazy");
			/** Intrinsic dimensions reserve the box before the bytes arrive, so
			 * copy below a lazy screenshot does not jump on a mobile ad click. */
			expect(image.getAttribute("width")).toBeTruthy();
			expect(image.getAttribute("height")).toBeTruthy();
			expect(image.getAttribute("alt")).toBeTruthy();
		}

		expect(proof.textContent?.trim()).not.toBe("");
	});

	/** The hero is the navy gradient. An opaque header stacked above it reads as
	 * a bar bolted onto the page rather than the landing treatment the brand
	 * guidelines call for. */
	it.each(SLUGS)("floats the header over the navy hero on /%s", async (slug) => {
		const { doc } = await loadPage(slug);

		const header = doc.querySelector("header");
		assert(header, `${slug} must render the site header`);
		expect(header.className).toContain("header--transparent");
	});

	/** The one testimonial the product has. A page may use it or not; no page may
	 * invent a second one. */
	it("quotes only the reader who actually said it", async () => {
		for (const slug of SLUGS) {
			const { doc } = await loadPage(slug);
			const quotes = Array.from(doc.querySelectorAll("[data-test-lp-quote]")).map(
				(quote) => quote.textContent,
			);
			for (const quote of quotes) {
				expect(quote).toBe("It just works.");
			}
		}
	});

	it.each(SLUGS)("marks the /%s limits as refusals, not features", async (slug) => {
		const { doc } = await loadPage(slug);

		const markers = doc.querySelectorAll(".lp-limits__item .lp-limits__marker svg");
		expect(markers).toHaveLength(LANDING_PAGE_CONTENT[slug].limits.length);
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

	/** The ads pointing here land mostly on phones, and three of the four primary
	 * actions want a desktop — an export file, a connector setting, a link to
	 * hand. A reader the page convinced has to be able to act from where they
	 * are. */
	it("leaves every page with a way to start an account, whatever device it was opened on", async () => {
		for (const slug of SLUGS) {
			const { doc } = await loadPage(slug);
			const closeTargets = Array.from(
				doc.querySelectorAll('[data-test-section="lp-close"] form.lp-action'),
			).map((form) => form.getAttribute("action"));

			expect(closeTargets).toContain("/signup");
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
