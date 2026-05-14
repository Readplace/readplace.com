import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { initBlogPosts } from "./blog.posts";

/** Initialised with the same limit as the default test fixture so post markdown
 * substitution matches what the running app produces. */
const blogPosts = initBlogPosts({ foundingMemberLimit: 3 });
const firstPost = blogPosts.getAllPosts()[0];

const useApp = useTestServer();

describe("GET /blog", () => {
	it("should return 200 and HTML content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render blog page title", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const title = doc.querySelector(".blog__title");
		expect(title?.textContent).toBe("Blog");
	});

	it("should render links to blog posts", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const link = doc.querySelector(
			`a[href="/blog/${firstPost.slug}"]`,
		);
		expect(link).not.toBeNull();
	});

	it("should render post titles in the listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const cardTitles = doc.querySelectorAll(".blog-card__title");
		const texts = Array.from(cardTitles).map((el) => el.textContent);
		expect(texts).toContain(firstPost.title);
	});

	it("should have correct SEO title", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toBe("Blog — Readplace");
	});

	it("should have canonical URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		const canonical = doc.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			"https://readplace.com/blog",
		);
	});

	it("should have the page-blog body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-blog")).toBe(true);
	});

	it("should have Blog and BreadcrumbList structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog");
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
	it("should return 200 for a valid post slug", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the post title as h1", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const h1 = doc.querySelector(".blog-post__title");
		expect(h1?.textContent).toBe(firstPost.title);
	});

	it("should render the post content as HTML", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const content = doc.querySelector(".blog-post__content");
		expect(content?.innerHTML.length).toBeGreaterThan(0);
	});

	it("should render post metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const author = doc.querySelector(".blog-post__author");
		expect(author?.textContent).toContain(firstPost.author);

		const date = doc.querySelector(".blog-post__date");
		expect(date?.getAttribute("datetime")).toBe(firstPost.date);
	});

	it("should have og:type set to article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const ogType = doc.querySelector('meta[property="og:type"]');
		expect(ogType?.getAttribute("content")).toBe("article");
	});

	it("should have BlogPosting structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		const canonical = doc.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			`https://readplace.com/blog/${firstPost.slug}`,
		);
	});

	it("should have the page-blog-post body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			`/blog/${firstPost.slug}`,
		);
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-blog-post")).toBe(true);
	});

	it("should return 404 for an unknown slug", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog/nonexistent-post");
		expect(response.status).toBe(404);
	});
});

describe("old hutch-vs-* slug redirects", () => {
	it("should 301 redirect hutch-vs-readwise-reader to readplace-vs-readwise-reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog/hutch-vs-readwise-reader");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-readwise-reader");
	});

	it("should 301 redirect hutch-vs-instapaper to readplace-vs-instapaper", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog/hutch-vs-instapaper");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-instapaper");
	});

	it("should 301 redirect hutch-vs-karakeep to readplace-vs-karakeep", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog/hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("/blog/readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later");
	});
});

describe("hutch-app.com blog redirect", () => {
	it("should 301 redirect /blog to readplace.com", async () => {
		const harness = useApp(
			createDefaultTestAppFixture("https://readplace.com"),
		);
		const response = await request(harness.server)
			.get("/blog")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://readplace.com/blog");
	});

	it("should 301 redirect /blog/:slug to readplace.com", async () => {
		const harness = useApp(
			createDefaultTestAppFixture("https://readplace.com"),
		);
		const response = await request(harness.server)
			.get(`/blog/${firstPost.slug}`)
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(
			`https://readplace.com/blog/${firstPost.slug}`,
		);
	});
});

describe("GET /sitemap.xml", () => {
	it("should include /blog in the sitemap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");
		expect(response.text).toContain("<loc>http://localhost:3000/blog</loc>");
	});

	it("should include blog post URLs in the sitemap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");
		expect(response.text).toContain(
			`<loc>http://localhost:3000/blog/${firstPost.slug}</loc>`,
		);
	});
});

describe("GET /blog with Accept: text/markdown", () => {
	it("returns 200 with text/markdown content-type and an x-markdown-tokens header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(Number(response.headers["x-markdown-tokens"])).toBeGreaterThan(0);
	});

	it("emits the site-wide Content-Signal policy and Vary: Accept", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog").set("Accept", "text/markdown");

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});

	it("renders the page heading as the markdown h1 and lists the first post title", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog").set("Accept", "text/markdown");

		expect(response.text.startsWith("# Blog")).toBe(true);
		expect(response.text).toContain(firstPost.title);
	});

	it("does not include the rendered HTML chrome (no <script>, no htmx, no data-test-*)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/blog").set("Accept", "text/markdown");

		expect(response.text).not.toContain("<script");
		expect(response.text).not.toContain("hx-boost");
		expect(response.text).not.toContain("data-test-");
	});
});

describe("GET /blog/:slug with Accept: text/markdown", () => {
	it("returns 200 with text/markdown content-type and the canonical URL header in frontmatter", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get(`/blog/${firstPost.slug}`)
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text.startsWith(`# ${firstPost.title}`)).toBe(true);
		expect(response.text).toContain(`Canonical: https://readplace.com/blog/${firstPost.slug}`);
		expect(response.text).toContain(`Author: ${firstPost.author}`);
	});

	it("serves the raw markdown source verbatim, without going through HTML conversion", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get(`/blog/${firstPost.slug}`)
			.set("Accept", "text/markdown");

		expect(response.text).toContain(firstPost.markdownContent.trim().split("\n")[0]);
	});
});

describe("HTML responses now carry the Content-Signal header", () => {
	it("sets Content-Signal: search=yes, ai-input=yes, ai-train=no on a plain HTML GET", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(`/blog/${firstPost.slug}`);

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});
