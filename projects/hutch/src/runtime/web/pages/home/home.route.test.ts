import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

/** Matches the default test fixture's `foundingAllocation.foundingMemberLimit`.
 * Tests own this constant so production changes to `PROD_FOUNDING_MEMBER_LIMIT`
 * cannot ripple through seed loops or assertions. */
const TEST_FOUNDING_MEMBER_LIMIT = 3;

const useApp = useTestServer();

describe("GET /", () => {
	it("should return 200 and HTML content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the hero headline with the full word list for screen readers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const srOnly = doc.querySelector(".home-hero__title .sr-only");
		expect(srOnly?.textContent).toBe("A home for articles, newsletters, essays, longreads, news, blogs, stories, posts, reports, and interviews.");
	});

	it("should render the visible headline portion aria-hidden with the initial rotator word", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const visible = doc.querySelector(".home-hero__title .hero-headline__visible");
		expect(visible?.getAttribute("aria-hidden")).toBe("true");
		expect(visible?.textContent?.replace(/\s+/g, " ").trim()).toBe("A home for articles");

		const rotator = doc.querySelector(".hero-headline__rotator");
		expect(rotator?.textContent).toBe("articles");
	});

	it("should include the headline word-swap client script", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		expect(response.text).toContain("hero-headline__rotator");
		expect(response.text).toContain("newsletters");
		expect(response.text).toContain("longreads");
	});

	it("should render a generic install CTA when browser is unrecognized", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.getAttribute("href")).toBe("/install");
		expect(cta?.textContent).toBe("Install Browser Extension");
	});

	it("should render Firefox install CTA when User-Agent is Firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Firefox Extension");
		expect(cta?.getAttribute("href")).toBe("/install?browser=firefox");

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Also available for Chrome");
	});

	it("should render Chrome install CTA when User-Agent is Chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Chrome Extension");
		expect(cta?.getAttribute("href")).toBe("/install?browser=chrome");

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Also available for Firefox");
	});

	it("should render Chrome install CTA when User-Agent is Edge", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Chrome Extension");
	});

	it("should render generic trust line when browser is unrecognized", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Firefox & Chrome");
	});

	it("should render browser-specific bottom install CTA for Firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
		const doc = new JSDOM(response.text).window.document;

		const bottomCta = doc.querySelector('[data-test-cta="bottom-install"]');
		expect(bottomCta?.textContent).toBe("Install Firefox Extension");
		expect(bottomCta?.getAttribute("href")).toBe("/install?browser=firefox");
	});

	it("should render the public reader-view paste-link form with UTM hidden inputs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const form = doc.querySelector("[data-test-home-try-form]");
		assert(form, "home try form must be rendered");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/view");

		const input = form.querySelector("input[name='url'][data-test-home-try-input]");
		assert(input, "url input must be rendered");
		expect(input.getAttribute("type")).toBe("url");
		expect(input.hasAttribute("required")).toBe(true);

		const utmSource = form.querySelector("input[name='utm_source']");
		expect(utmSource?.getAttribute("value")).toBe("homepage");
		const utmMedium = form.querySelector("input[name='utm_medium']");
		expect(utmMedium?.getAttribute("value")).toBe("internal");
		const utmContent = form.querySelector("input[name='utm_content']");
		expect(utmContent?.getAttribute("value")).toBe("homepage-link-input");

		const submit = form.querySelector("[data-test-home-try-submit]");
		expect(submit?.textContent).toBe("Open in reader view");
	});

	it("should redirect homepage paste-link submissions to /view/<encoded-url> preserving UTM on the logged pageview", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			"/view?url=https%3A%2F%2Fexample.com%2Farticle&utm_source=homepage&utm_medium=internal&utm_content=homepage-link-input",
		);
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe(
			`/view/${encodeURIComponent("https://example.com/article")}`,
		);
	});

	it("should render the secondary CTA linking to GitHub", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="view-github"]');
		expect(cta?.getAttribute("href")).toBe("https://github.com/Readplace/readplace.com");
		expect(cta?.textContent).toBe("View on GitHub");
	});

	it("should render the core features section with shipped features only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const coreSection = doc.querySelector('[data-test-section="core-features"]');
		const features = coreSection?.querySelectorAll("[data-test-feature]");
		expect(features?.length).toBe(12);
	});

	it("should render three demo videos: Desktop, Firefox Extension, and Chrome Extension", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const demoSection = doc.querySelector('[data-test-section="demo"]');
		const videoLabels = demoSection?.querySelectorAll(".home-demo__video-label");
		const labels = Array.from(videoLabels ?? []).map((el) => el.textContent);
		expect(labels).toEqual(["Desktop", "Firefox Extension", "Chrome Extension"]);
	});

	it("should render the backstory section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const backstory = doc.querySelector('[data-test-section="backstory"]');
		expect(backstory).not.toBeNull();
	});

	it("should render the founding pricing card and hide the fallback when under the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		expect(founding.querySelector(".pricing-card__name")?.textContent).toBe("Founding Member");
		expect(founding.querySelector(".pricing-card__price")?.textContent).toContain("$0");

		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--visible")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback");
		assert(fallback, "fallback wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback--hidden")).toBe(true);
	});

	it("should render the founding pricing title when under the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const title = doc.querySelector('[data-test-pricing-title] .section-header__title');
		expect(title?.textContent).toBe(`Free for the first ${TEST_FOUNDING_MEMBER_LIMIT} members.`);
	});

	it("should render the founding members progress bar with zero users", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const progress = doc.querySelector("[data-test-founding-progress]");
		const label = progress?.querySelector(".founding-progress__label");
		expect(label?.textContent).toBe(`0 / ${TEST_FOUNDING_MEMBER_LIMIT} founding members`);

		const fill = progress?.querySelector(".founding-progress__fill");
		expect(fill?.getAttribute("style")).toBe("width: 0%");
	});


	it("should render the comparison table", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const table = doc.querySelector("[data-test-comparison-table]");
		const rows = table?.querySelectorAll("tbody tr");
		expect(rows?.length).toBe(8);
	});

	it("should render the trust section with three trust items", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trustSection = doc.querySelector('[data-test-section="trust"]');
		const cards = trustSection?.querySelectorAll(".trust-card");
		expect(cards?.length).toBe(3);
	});

	it("should render the canonical disambiguation section explaining extension capture vs link submission", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="canonical"]');
		assert(section, "canonical disambiguation section must be rendered");
		expect(section.querySelector(".home-canonical__heading")?.textContent).toContain("Same article");
		const body = section.textContent ?? "";
		expect(body).toContain("DeepSeek");
		expect(body).toContain("extension");
		expect(body).toContain("canonical");
	});

	it("should render the decline statements section listing what Readplace will not become", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="decline"]');
		assert(section, "decline statements section must be rendered");
		const items = section.querySelectorAll("[data-test-decline-list] .home-decline__item");
		expect(items.length).toBe(4);
		const itemTexts = Array.from(items).map((el) => el.textContent?.trim());
		expect(itemTexts).toContain("Nested folder hierarchies");
	});

	it("should render the cost transparency section naming the paid pipeline providers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="cost-transparency"]');
		assert(section, "cost transparency section must be rendered");
		expect(section.querySelector(".home-cost__heading")?.textContent).toContain("$3.99");
		const items = section.querySelectorAll("[data-test-cost-list] .home-cost__item");
		expect(items.length).toBe(3);
		const text = section.textContent ?? "";
		expect(text).toContain("Mozilla Readability");
		expect(text).toContain("DeepSeek");
		expect(text).toContain("Deep Infra");
		expect(text).toContain("no data resale");
	});

	it("should render the failure-mode paragraph inside the backstory", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const para = doc.querySelector("[data-test-failure-mode]");
		assert(para, "failure-mode paragraph must be rendered");
		const text = para.textContent ?? "";
		expect(text).toContain("GitHub");
		expect(text).toContain("Sydney");
		expect(text).toContain("self-host");
	});


	it("should have page-home body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-home")).toBe(true);
	});

	it("should set appropriate SEO metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toContain("Readplace");
		expect(doc.title).toContain("Read-It-Later App");
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("read-it-later");
	});

	it("should include author and keywords meta tags", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const author = doc.querySelector('meta[name="author"]');
		expect(author?.getAttribute("content")).toBe("Fayner Brack");

		const keywords = doc.querySelector('meta[name="keywords"]');
		expect(keywords?.getAttribute("content")).toContain("Pocket alternative");
	});

	it("should include Open Graph image alt text", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const ogImageAlt = doc.querySelector('meta[property="og:image:alt"]');
		expect(ogImageAlt?.getAttribute("content")).toContain("Readplace");
	});

	it("should not include twitter:site when no handle is configured", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const twitterSite = doc.querySelector('meta[name="twitter:site"]');
		expect(twitterSite).toBeNull();
	});

	it("should include multiple structured data schemas", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));

		const types = schemas.map((s: { "@type": string }) => s["@type"]);
		expect(types).toEqual(["WebApplication", "Organization", "FAQPage", "WebSite"]);
	});

	it("should include FAQ structured data with questions and answers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const faq = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");

		expect(faq.mainEntity.length).toBe(5);
		expect(faq.mainEntity[0].name).toBe("What is Readplace?");
		expect(faq.mainEntity[4].name).toBe("What does the $3.99/month subscription pay for?");
	});

	it("should render section landmarks with aria-labels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const hero = doc.querySelector('[data-test-section="hero"]');
		expect(hero?.getAttribute("aria-label")).toBe("Introduction");

		const pricing = doc.querySelector('[data-test-section="pricing"]');
		expect(pricing?.getAttribute("aria-label")).toBe("Pricing");
	});

	it("should use scope attributes on comparison table headers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const colHeaders = doc.querySelectorAll('[data-test-comparison-table] thead th[scope="col"]');
		expect(colHeaders.length).toBe(7);

		const rowHeaders = doc.querySelectorAll('[data-test-comparison-table] tbody th[scope="row"]');
		expect(rowHeaders.length).toBe(8);
	});
});
