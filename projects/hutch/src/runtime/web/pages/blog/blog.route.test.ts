import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { getAllPosts } from "./blog.posts";

const firstPost = getAllPosts()[0];

describe("GET /blog", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return 200 and HTML content", async () => {
		const response = await request(app).get("/blog");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render blog page title", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const title = doc.querySelector(".blog__title");
		expect(title?.textContent).toBe("Blog");
	});

	it("should render links to blog posts", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const link = doc.querySelector(
			`a[href="/blog/${firstPost.slug}"]`,
		);
		expect(link).not.toBeNull();
	});

	it("should render post titles in the listing", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const cardTitles = doc.querySelectorAll(".blog-card__title");
		const texts = Array.from(cardTitles).map((el) => el.textContent);
		expect(texts).toContain(firstPost.title);
	});

	it("should have correct SEO title", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toBe("Blog — Readplace");
	});

	it("should have canonical URL", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const canonical = doc.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			"https://readplace.com/blog",
		);
	});

	it("should have the page-blog body class", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-blog")).toBe(true);
	});

	it("should have Blog and BreadcrumbList structured data", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll(
			'script[type="application/ld+json"]',
		);
		const schemas = Array.from(scripts).map((s) =>
			JSON.parse(s.textContent ?? "{}"),
		);
		const blog = schemas.find(
			(s: { "@type": string }) => s["@type"] === "Blog",
		);
		expect(blog).toBeDefined();
		expect(blog.url).toBe("https://readplace.com/blog");
		expect(Array.isArray(blog.blogPost)).toBe(true);
		expect(blog.blogPost.length).toBeGreaterThan(0);

		const breadcrumb = schemas.find(
			(s: { "@type": string }) => s["@type"] === "BreadcrumbList",
		);
		expect(breadcrumb).toBeDefined();
		expect(breadcrumb.itemListElement).toEqual([
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://readplace.com/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Blog",
				item: "https://readplace.com/blog",
			},
		]);
	});
});

describe("GET /blog/:slug", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return 200 for a valid post slug", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the post title as h1", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const h1 = doc.querySelector(".blog-post__title");
		expect(h1?.textContent).toBe(firstPost.title);
	});

	it("should render the post content as HTML", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const content = doc.querySelector(".blog-post__content");
		expect(content?.innerHTML.length).toBeGreaterThan(0);
	});

	it("should render post metadata", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const author = doc.querySelector(".blog-post__author");
		expect(author?.textContent).toContain(firstPost.author);

		const date = doc.querySelector(".blog-post__date");
		expect(date?.getAttribute("datetime")).toBe(firstPost.date);
	});

	it("should have og:type set to article", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const ogType = doc.querySelector('meta[property="og:type"]');
		expect(ogType?.getAttribute("content")).toBe("article");
	});

	it("should have BlogPosting structured data", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const ldJson = doc.querySelector(
			'script[type="application/ld+json"]',
		);
		expect(ldJson).not.toBeNull();
		const data = JSON.parse(ldJson?.textContent ?? "{}");
		expect(data["@type"]).toBe("BlogPosting");
		expect(data.headline).toBe(firstPost.title);
	});

	it("should have BreadcrumbList structured data", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll(
			'script[type="application/ld+json"]',
		);
		const schemas = Array.from(scripts).map((s) =>
			JSON.parse(s.textContent ?? "{}"),
		);
		const breadcrumb = schemas.find(
			(s: { "@type": string }) => s["@type"] === "BreadcrumbList",
		);
		expect(breadcrumb).toBeDefined();
		expect(breadcrumb.itemListElement).toEqual([
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://readplace.com/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Blog",
				item: "https://readplace.com/blog",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: firstPost.title,
				item: `https://readplace.com/blog/${firstPost.slug}`,
			},
		]);
	});

	it("should have correct canonical URL", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const canonical = doc.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			`https://readplace.com/blog/${firstPost.slug}`,
		);
	});

	it("should have the page-blog-post body class", async () => {
		const response = await request(app).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-blog-post")).toBe(true);
	});

	it("should return 404 for an unknown slug", async () => {
		const response = await request(app).get("/blog/nonexistent-post");
		expect(response.status).toBe(404);
	});
});

describe("old hutch-vs-* slug redirects", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should 301 redirect hutch-vs-readwise-reader to readplace-vs-readwise-reader", async () => {
		const response = await request(app).get("/blog/hutch-vs-readwise-reader");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-readwise-reader");
	});

	it("should 301 redirect hutch-vs-instapaper to readplace-vs-instapaper", async () => {
		const response = await request(app).get("/blog/hutch-vs-instapaper");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-instapaper");
	});

	it("should 301 redirect hutch-vs-karakeep to readplace-vs-karakeep", async () => {
		const response = await request(app).get("/blog/hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later");
	});
});

describe("hutch-app.com blog redirect", () => {
	it("should 301 redirect /blog to readplace.com", async () => {
		const { app } = createTestApp(
			createDefaultTestAppFixture("https://readplace.com"),
		);
		const response = await request(app)
			.get("/blog")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://readplace.com/blog");
	});

	it("should 301 redirect /blog/:slug to readplace.com", async () => {
		const { app } = createTestApp(
			createDefaultTestAppFixture("https://readplace.com"),
		);
		const response = await request(app)
			.get(`/blog/${firstPost.slug}`)
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(
			`https://readplace.com/blog/${firstPost.slug}`,
		);
	});
});

describe("GET /sitemap.xml", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should include /blog in the sitemap", async () => {
		const response = await request(app).get("/sitemap.xml");
		expect(response.text).toContain("<loc>http://localhost:3000/blog</loc>");
	});

	it("should include blog post URLs in the sitemap", async () => {
		const response = await request(app).get("/sitemap.xml");
		expect(response.text).toContain(
			`<loc>http://localhost:3000/blog/${firstPost.slug}</loc>`,
		);
	});
});
