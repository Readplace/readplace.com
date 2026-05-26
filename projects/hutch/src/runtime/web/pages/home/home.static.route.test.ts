import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { initBlogPosts } from "../blog/blog.posts";

const TEST_FOUNDING_MEMBER_LIMIT = 3;

const blogPosts = initBlogPosts({ foundingMemberLimit: TEST_FOUNDING_MEMBER_LIMIT });

const useApp = useTestServer();

describe("GET / with exhausted founding allocation", () => {
	it("should hide the founding progress when users exceed the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector("[data-test-founding-progress]")).toBeNull();
	}, 30000);

	it("should hide the founding pricing card and show the fallback benefits + CTA when over the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `over${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--hidden")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback");
		assert(fallback, "fallback wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback--visible")).toBe(true);

		const benefits = fallback.querySelector("[data-test-fallback-benefits]");
		assert(benefits, "fallback benefits list must be rendered");
		expect(benefits.querySelectorAll(".pricing-card__feature").length).toBe(6);
		expect(fallback.querySelector('[data-test-cta="become-member"]')).not.toBeNull();
	}, 30000);

	it("should hide the founding pricing title when over the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `title${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector("[data-test-pricing-title]")).toBeNull();
		expect(response.text).not.toContain(`Free for the first ${TEST_FOUNDING_MEMBER_LIMIT} members.`);
	}, 30000);
});

describe("GET /favicon.ico", () => {
	it("should 301 redirect to the static CDN's favicon.ico", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/favicon.ico");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://static.test/favicon.ico");
	});
});

describe("GET /apple-touch-icon*.png", () => {
	it.each([
		"/apple-touch-icon.png",
		"/apple-touch-icon-precomposed.png",
		"/apple-touch-icon-57x57.png",
		"/apple-touch-icon-180x180.png",
	])("should 301 redirect %s to the static CDN", async (path) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(`https://static.test${path}`);
	});

	it("should fall through to 404 for paths that don't match the apple-touch-icon shape", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/apple-touch-icon-invalid.png");
		expect(response.status).toBe(404);
	});
});

describe("GET /robots.txt", () => {
	it("should return a text response with crawl directives", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("User-agent: *");
		expect(response.text).toContain("Allow: /");
		expect(response.text).toContain("Disallow: /queue");
		expect(response.text).toContain("Sitemap:");
	});
});

describe("GET /llms.txt", () => {
	it("should return a text response with the product overview", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("read-it-later");
		expect(response.text).toContain("## Pages");
	});

	it("advertises the markdown content-negotiation capability", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms.txt");
		expect(response.text).toContain("Accept: text/markdown");
	});
});

describe("GET / with Accept: text/markdown", () => {
	it("returns 200 with text/markdown content-type instead of redirecting to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers.location).toBeUndefined();
	});

	it("converts the comparison table into markdown table syntax", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.text).toMatch(/\|\s+-+\s+\|/);
	});

	it("emits the Content-Signal policy and Vary: Accept", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});

describe("GET / HTML response gains the Content-Signal header", () => {
	it("sets the site-wide Content-Signal policy on plain HTML GETs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});

describe("GET /llms-full.txt", () => {
	it("should return a text response with the full product details", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms-full.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("## Features");
		expect(response.text).toContain("## About");
		expect(response.text).toContain("## Privacy");
	});
});

describe("GET /sitemap.xml", () => {
	it("should return an XML sitemap with exactly the public pages", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/xml/);

		const urls = Array.from(response.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
		const blogPostUrls = blogPosts.getAllSlugs().map((slug) => `http://localhost:3000/blog/${slug}`);
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
	it("should return 404", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/nonexistent");
		expect(response.status).toBe(404);
	});
});
