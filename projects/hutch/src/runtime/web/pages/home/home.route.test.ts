import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { getAllSlugs } from "../blog/blog.posts";

describe("GET /", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return 200 and HTML content", async () => {
		const response = await request(app).get("/");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the hero headline with the full word list for screen readers", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const srOnly = doc.querySelector(".home-hero__title .sr-only");
		expect(srOnly?.textContent).toBe("A home for articles, newsletters, essays, longreads, news, blogs, stories, posts, reports, and interviews.");
	});

	it("should render the visible headline portion aria-hidden with the initial rotator word", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const visible = doc.querySelector(".home-hero__title .hero-headline__visible");
		expect(visible?.getAttribute("aria-hidden")).toBe("true");
		expect(visible?.textContent?.replace(/\s+/g, " ").trim()).toBe("A home for articles");

		const rotator = doc.querySelector(".hero-headline__rotator");
		expect(rotator?.textContent).toBe("articles");
	});

	it("should include the headline word-swap client script", async () => {
		const response = await request(app).get("/");
		expect(response.text).toContain("hero-headline__rotator");
		expect(response.text).toContain("newsletters");
		expect(response.text).toContain("longreads");
	});

	it("should render a generic install CTA when browser is unrecognized", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.getAttribute("href")).toBe("/install");
		expect(cta?.textContent).toBe("Install Browser Extension");
	});

	it("should render Firefox install CTA when User-Agent is Firefox", async () => {
		const response = await request(app)
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
		const response = await request(app)
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
		const response = await request(app)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Chrome Extension");
	});

	it("should render generic trust line when browser is unrecognized", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Firefox & Chrome");
	});

	it("should render browser-specific bottom install CTA for Firefox", async () => {
		const response = await request(app)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
		const doc = new JSDOM(response.text).window.document;

		const bottomCta = doc.querySelector('[data-test-cta="bottom-install"]');
		expect(bottomCta?.textContent).toBe("Install Firefox Extension");
		expect(bottomCta?.getAttribute("href")).toBe("/install?browser=firefox");
	});

	it("should render the public reader-view paste-link form with UTM hidden inputs", async () => {
		const response = await request(app).get("/");
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
		const response = await request(app).get(
			"/view?url=https%3A%2F%2Fexample.com%2Farticle&utm_source=homepage&utm_medium=internal&utm_content=homepage-link-input",
		);
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe(
			`/view/${encodeURIComponent("https://example.com/article")}`,
		);
	});

	it("should render the secondary CTA linking to GitHub", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="view-github"]');
		expect(cta?.getAttribute("href")).toBe("https://github.com/Readplace/readplace.com");
		expect(cta?.textContent).toBe("View on GitHub");
	});

	it("should render the core features section with shipped features only", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const coreSection = doc.querySelector('[data-test-section="core-features"]');
		const features = coreSection?.querySelectorAll("[data-test-feature]");
		expect(features?.length).toBe(10);
	});

	it("should render three demo videos: Desktop, Firefox Extension, and Chrome Extension", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const demoSection = doc.querySelector('[data-test-section="demo"]');
		const videoLabels = demoSection?.querySelectorAll(".home-demo__video-label");
		const labels = Array.from(videoLabels ?? []).map((el) => el.textContent);
		expect(labels).toEqual(["Desktop", "Firefox Extension", "Chrome Extension"]);
	});

	it("should render the backstory section", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const backstory = doc.querySelector('[data-test-section="backstory"]');
		expect(backstory).not.toBeNull();
	});

	it("should render the founding pricing card and hide the fallback CTA when under the limit", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		expect(founding.querySelector(".pricing-card__name")?.textContent).toBe("Founding Member");
		expect(founding.querySelector(".pricing-card__price")?.textContent).toContain("$0");

		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--visible")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback-cta");
		assert(fallback, "fallback CTA wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback-cta--hidden")).toBe(true);
	});

	it("should render the founding members progress bar with zero users", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const progress = doc.querySelector("[data-test-founding-progress]");
		const label = progress?.querySelector(".founding-progress__label");
		expect(label?.textContent).toBe("0 / 100 founding members");

		const fill = progress?.querySelector(".founding-progress__fill");
		expect(fill?.getAttribute("style")).toBe("width: 0%");
	});


	it("should render the comparison table", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const table = doc.querySelector("[data-test-comparison-table]");
		const rows = table?.querySelectorAll("tbody tr");
		expect(rows?.length).toBe(7);
	});

	it("should render the trust section with two trust items", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trustSection = doc.querySelector('[data-test-section="trust"]');
		const cards = trustSection?.querySelectorAll(".trust-card");
		expect(cards?.length).toBe(1);
	});


	it("should have page-home body class", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-home")).toBe(true);
	});

	it("should set appropriate SEO metadata", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toContain("Readplace");
		expect(doc.title).toContain("Read-It-Later App");
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("read-it-later");
	});

	it("should include author and keywords meta tags", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const author = doc.querySelector('meta[name="author"]');
		expect(author?.getAttribute("content")).toBe("Fayner Brack");

		const keywords = doc.querySelector('meta[name="keywords"]');
		expect(keywords?.getAttribute("content")).toContain("Pocket alternative");
	});

	it("should include Open Graph image alt text", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const ogImageAlt = doc.querySelector('meta[property="og:image:alt"]');
		expect(ogImageAlt?.getAttribute("content")).toContain("Readplace");
	});

	it("should not include twitter:site when no handle is configured", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const twitterSite = doc.querySelector('meta[name="twitter:site"]');
		expect(twitterSite).toBeNull();
	});

	it("should include multiple structured data schemas", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));

		const types = schemas.map((s: { "@type": string }) => s["@type"]);
		expect(types).toEqual(["WebApplication", "Organization", "FAQPage", "WebSite"]);
	});

	it("should include FAQ structured data with questions and answers", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const faq = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");

		expect(faq.mainEntity.length).toBe(4);
		expect(faq.mainEntity[0].name).toBe("What is Readplace?");
	});

	it("should render section landmarks with aria-labels", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const hero = doc.querySelector('[data-test-section="hero"]');
		expect(hero?.getAttribute("aria-label")).toBe("Introduction");

		const pricing = doc.querySelector('[data-test-section="pricing"]');
		expect(pricing?.getAttribute("aria-label")).toBe("Pricing");
	});

	it("should use scope attributes on comparison table headers", async () => {
		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const colHeaders = doc.querySelectorAll('[data-test-comparison-table] thead th[scope="col"]');
		expect(colHeaders.length).toBe(7);

		const rowHeaders = doc.querySelectorAll('[data-test-comparison-table] tbody th[scope="row"]');
		expect(rowHeaders.length).toBe(7);
	});
});

describe("GET / with exhausted founding allocation", () => {
	it("should hide the founding progress when users exceed the limit", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		for (let i = 0; i < 100; i++) {
			await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
		}

		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector("[data-test-founding-progress]")).toBeNull();
	}, 30000);

	it("should hide the founding pricing card and show the fallback CTA when over the limit", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		for (let i = 0; i < 100; i++) {
			await auth.createUser({ email: `over${i}@test.com`, password: "password123" });
		}

		const response = await request(app).get("/");
		const doc = new JSDOM(response.text).window.document;

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--hidden")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback-cta");
		assert(fallback, "fallback CTA wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback-cta--visible")).toBe(true);
	}, 30000);
});

describe("GET /favicon.ico", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should 301 redirect to the static CDN's favicon.ico", async () => {
		const response = await request(app).get("/favicon.ico");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://static.test/favicon.ico");
	});
});

describe("GET /apple-touch-icon*.png", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it.each([
		"/apple-touch-icon.png",
		"/apple-touch-icon-precomposed.png",
		"/apple-touch-icon-57x57.png",
		"/apple-touch-icon-180x180.png",
	])("should 301 redirect %s to the static CDN", async (path) => {
		const response = await request(app).get(path);
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(`https://static.test${path}`);
	});

	it("should fall through to 404 for paths that don't match the apple-touch-icon shape", async () => {
		const response = await request(app).get("/apple-touch-icon-invalid.png");
		expect(response.status).toBe(404);
	});
});

describe("GET /robots.txt", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return a text response with crawl directives", async () => {
		const response = await request(app).get("/robots.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("User-agent: *");
		expect(response.text).toContain("Allow: /");
		expect(response.text).toContain("Disallow: /queue");
		expect(response.text).toContain("Sitemap:");
	});
});

describe("GET /llms.txt", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return a text response with the product overview", async () => {
		const response = await request(app).get("/llms.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("read-it-later");
		expect(response.text).toContain("## Pages");
	});
});

describe("GET /llms-full.txt", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return a text response with the full product details", async () => {
		const response = await request(app).get("/llms-full.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("## Features");
		expect(response.text).toContain("## About");
		expect(response.text).toContain("## Privacy");
	});
});

describe("GET /sitemap.xml", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return an XML sitemap with exactly the public pages", async () => {
		const response = await request(app).get("/sitemap.xml");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/xml/);

		const urls = Array.from(response.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
		const blogPostUrls = getAllSlugs().map((slug) => `http://localhost:3000/blog/${slug}`);
		expect(urls).toEqual([
			"http://localhost:3000/",
			"http://localhost:3000/blog",
			"http://localhost:3000/install",
			"http://localhost:3000/login",
			"http://localhost:3000/signup",
			"http://localhost:3000/privacy",
			"http://localhost:3000/terms",
			"http://localhost:3000/llms.txt",
			"http://localhost:3000/llms-full.txt",
			...blogPostUrls,
		]);
	});
});

describe("GET /nonexistent", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return 404", async () => {
		const response = await request(app).get("/nonexistent");
		expect(response.status).toBe(404);
	});
});
