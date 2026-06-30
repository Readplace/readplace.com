import assert from "node:assert/strict";
import express from "express";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { type ChangelogBanner, initBase, isChangelogVersion } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createBlogApp } from "../../../app";
import { initBlogRoutes } from "./blog.page";
import { type BlogPosts, initBlogPosts } from "./blog.posts";

/** Every reader resolves to guest unless a test injects a different resolver —
 * the default that public crawler traffic hits. */
const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

/** Resolves the canonical `hutch_sid=valid` cookie to an authenticated reader,
 * everything else to guest — the seam that drives the authenticated-nav test
 * without standing up a real session store (DI, not mocks). */
const authedResolver: ResolveLogin = async (cookieHeader) =>
	cookieHeader === "hutch_sid=valid"
		? { isAuthenticated: true, userId: authenticatedUserIdFrom("user-1"), emailVerified: true }
		: { isAuthenticated: false };

const app = createBlogApp({ staticBaseUrl: "", liveReload: false }, { resolveLogin: guestResolver });
const blogPosts = initBlogPosts();
const firstPost = blogPosts.getAllPosts()[0];

const FAKE_VERSION = "a1b2c3d4";
assert(isChangelogVersion(FAKE_VERSION));
const FAKE_BANNER: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: FAKE_VERSION,
};

/** Builds an app whose blog routes are driven by an injected `blogPosts`, so a
 * test can control the changelog banner independently of the on-disk posts. */
function appWithChangelogBanner(banner: ChangelogBanner | undefined) {
	const blogPostsStub: BlogPosts = {
		getAllPosts: () => [],
		findPostBySlug: () => undefined,
		getAllSlugs: () => [],
		getAllPostMetadata: () => [],
		getLatestChangelogBanner: () => banner,
	};
	const expressApp = express();
	expressApp.disable("x-powered-by");
	const base = initBase({ staticBaseUrl: "", liveReload: false });
	expressApp.use(
		"/blog",
		initBlogRoutes({ blogPosts: blogPostsStub, base, resolveLogin: guestResolver }),
	);
	return expressApp;
}

/** Builds an app whose blog routes resolve login via the given resolver, so a
 * test can drive the header between guest and authenticated nav by cookie. */
function appWithResolver(resolveLogin: ResolveLogin) {
	const expressApp = express();
	expressApp.disable("x-powered-by");
	const base = initBase({ staticBaseUrl: "", liveReload: false });
	expressApp.use("/blog", initBlogRoutes({ blogPosts, base, resolveLogin }));
	return expressApp;
}

describe("GET /blog", () => {
	it("should return 200 and HTML content", async () => {
		const response = await request(app).get("/blog");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render blog page title", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(".blog__title")?.textContent).toBe("Blog");
	});

	it("should render links to blog posts", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(`a[href="/blog/${firstPost.slug}"]`)).not.toBeNull();
	});

	it("should render post titles in the listing", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;
		const texts = Array.from(doc.querySelectorAll(".blog-card__title")).map((el) => el.textContent);
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
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
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
		const schemas = Array.from(
			doc.querySelectorAll('script[type="application/ld+json"]'),
		).map((s) => JSON.parse(s.textContent ?? "{}"));

		const blog = schemas.find((s: { "@type": string }) => s["@type"] === "Blog");
		expect(blog).toBeDefined();
		expect(blog.url).toBe("https://readplace.com/blog");
		expect(Array.isArray(blog.blogPost)).toBe(true);
		expect(blog.blogPost.length).toBeGreaterThan(0);

		const breadcrumb = schemas.find((s: { "@type": string }) => s["@type"] === "BreadcrumbList");
		expect(breadcrumb).toBeDefined();
		expect(breadcrumb.itemListElement).toEqual([
			{ "@type": "ListItem", position: 1, name: "Home", item: "https://readplace.com/" },
			{ "@type": "ListItem", position: 2, name: "Blog", item: "https://readplace.com/blog" },
		]);
	});

	it("renders the guest header nav when no session cookie resolves to a user", async () => {
		const response = await request(app).get("/blog");
		const doc = new JSDOM(response.text).window.document;
		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
	});

	it("renders the authenticated header nav when the session cookie resolves to a user", async () => {
		const response = await request(appWithResolver(authedResolver))
			.get("/blog")
			.set("Cookie", "hutch_sid=valid");
		const doc = new JSDOM(response.text).window.document;
		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
		const items = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) =>
			el.getAttribute("data-test-nav-item"),
		);
		expect(items).toEqual(expect.arrayContaining(["queue", "import", "export", "account", "logout"]));
	});
});

describe("GET /blog/:slug", () => {
	it("should return 200 for a valid post slug", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the post title as h1", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(".blog-post__title")?.textContent).toBe(firstPost.title);
	});

	it("should render the post content as HTML", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(".blog-post__content")?.innerHTML.length ?? 0).toBeGreaterThan(0);
	});

	// The blog renders no TL;DR summary slot, so it is out of scope for the
	// summary open/close instrumentation: there is nothing to collapse or beacon.
	it("renders no reader summary slot (the blog has no TL;DR to instrument)", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-reader-summary]")).toBeNull();
		expect(doc.querySelector(".article-body__summary")).toBeNull();
	});

	it("should render post metadata", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(".blog-post__author")?.textContent).toContain(firstPost.author);
		expect(doc.querySelector(".blog-post__date")?.getAttribute("datetime")).toBe(firstPost.date);
	});

	it("should have og:type set to article", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe("article");
	});

	it("should have BlogPosting structured data", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		const data = JSON.parse(
			doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}",
		);
		expect(data["@type"]).toBe("BlogPosting");
		expect(data.headline).toBe(firstPost.title);
	});

	it("should have correct canonical URL", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			`https://readplace.com/blog/${firstPost.slug}`,
		);
	});

	it("should have the page-blog-post body class", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.body.classList.contains("page-blog-post")).toBe(true);
	});

	it("should return 404 for an unknown slug", async () => {
		const response = await request(app).get("/blog/nonexistent-post");
		expect(response.status).toBe(404);
	});
});

describe("old hutch-vs-* slug redirects", () => {
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

describe("GET /blog/sitemap.xml", () => {
	it("lists /blog and every post URL as absolute readplace.com URLs", async () => {
		const response = await request(app).get("/blog/sitemap.xml");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/xml/);
		expect(response.text).toContain("<loc>https://readplace.com/blog</loc>");
		expect(response.text).toContain(
			`<loc>https://readplace.com/blog/${firstPost.slug}</loc>`,
		);
	});

	it("carries no Content-Signal header (machine metadata, not a page)", async () => {
		const response = await request(app).get("/blog/sitemap.xml");
		expect(response.headers["content-signal"]).toBeUndefined();
	});
});

describe("GET /blog with Accept: text/markdown", () => {
	it("returns 200 with text/markdown content-type and an x-markdown-tokens header", async () => {
		const response = await request(app).get("/blog").set("Accept", "text/markdown");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(Number(response.headers["x-markdown-tokens"])).toBeGreaterThan(0);
	});

	it("emits the Content-Signal policy and Vary: Accept", async () => {
		const response = await request(app).get("/blog").set("Accept", "text/markdown");
		expect(response.headers["content-signal"]).toBe("search=yes, ai-input=yes, ai-train=no");
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});

	it("renders the page heading as the markdown h1 and lists the first post title", async () => {
		const response = await request(app).get("/blog").set("Accept", "text/markdown");
		expect(response.text.startsWith("# Blog")).toBe(true);
		expect(response.text).toContain(firstPost.title);
	});

	it("does not include the rendered HTML chrome", async () => {
		const response = await request(app).get("/blog").set("Accept", "text/markdown");
		expect(response.text).not.toContain("<script");
		expect(response.text).not.toContain("data-test-");
	});
});

describe("GET /blog/:slug with Accept: text/markdown", () => {
	it("returns 200 with text/markdown and the canonical URL in frontmatter", async () => {
		const response = await request(app)
			.get(`/blog/${firstPost.slug}`)
			.set("Accept", "text/markdown");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text.startsWith(`# ${firstPost.title}`)).toBe(true);
		expect(response.text).toContain(`Canonical: https://readplace.com/blog/${firstPost.slug}`);
		expect(response.text).toContain(`Author: ${firstPost.author}`);
	});

	it("serves the raw markdown source verbatim, without HTML conversion", async () => {
		const response = await request(app)
			.get(`/blog/${firstPost.slug}`)
			.set("Accept", "text/markdown");
		expect(response.text).toContain(firstPost.markdownContent.trim().split("\n")[0]);
	});
});

describe("GET /blog/changelog-banner", () => {
	it("returns 200 with a parseable fragment when a changelog banner exists", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER)).get(
			"/blog/changelog-banner",
		);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		const root = new JSDOM(response.text).window.document.querySelector("[data-changelog-version]");
		expect(root?.getAttribute("data-changelog-version")).toBe(FAKE_BANNER.version);
		expect(root?.querySelector("a")?.getAttribute("href")).toBe(FAKE_BANNER.href);
	});

	it("returns 204 with no body when there is nothing to announce", async () => {
		const response = await request(appWithChangelogBanner(undefined)).get(
			"/blog/changelog-banner",
		);
		expect(response.status).toBe(204);
		expect(response.text).toBe("");
	});

	it("is matched as the fragment endpoint, not as a post slug", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER)).get(
			"/blog/changelog-banner",
		);
		// A 404 would mean it fell through to the /:slug handler (NotFoundPage).
		expect(response.status).toBe(200);
	});
});

describe("changelog banner on /blog pages", () => {
	it("renders the visible banner on the index when one exists and is not dismissed", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER)).get("/blog");
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner?.querySelector(".changelog-banner__hook")?.textContent).toBe(FAKE_BANNER.hook);
	});

	it("renders the hidden shell on the index when there is nothing to announce", async () => {
		const response = await request(appWithChangelogBanner(undefined)).get("/blog");
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("hides the banner when the dismissal cookie matches the banner version", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER))
			.get("/blog")
			.set("Cookie", `rp_changelog_dismissed=${FAKE_BANNER.version}`);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("keeps showing the banner when the dismissal cookie is for a different version", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER))
			.get("/blog")
			.set("Cookie", "rp_changelog_dismissed=00000000");
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--visible")).toBe(true);
	});

	it("shows the banner with 200 (not 500) when the dismissal cookie is a malformed percent-escape", async () => {
		const response = await request(appWithChangelogBanner(FAKE_BANNER))
			.get("/blog")
			.set("Cookie", "rp_changelog_dismissed=%");
		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"[data-test-changelog-banner]",
		);
		expect(banner?.classList.contains("changelog-banner--visible")).toBe(true);
	});

	it("renders the banner on a post page too and posts that post's path so dismissing stays on the post", async () => {
		const slug = firstPost.slug;
		const blogPostsStub: BlogPosts = {
			getAllPosts: () => [firstPost],
			findPostBySlug: (s) => (s === slug ? firstPost : undefined),
			getAllSlugs: () => [slug],
			getAllPostMetadata: () => [{ slug, date: firstPost.date }],
			getLatestChangelogBanner: () => FAKE_BANNER,
		};
		const expressApp = express();
		expressApp.disable("x-powered-by");
		const base = initBase({ staticBaseUrl: "", liveReload: false });
		expressApp.use(
			"/blog",
			initBlogRoutes({ blogPosts: blogPostsStub, base, resolveLogin: guestResolver }),
		);

		const response = await request(expressApp).get(`/blog/${slug}`);
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-changelog-banner]");
		expect(banner?.classList.contains("changelog-banner--visible")).toBe(true);
		const returnTo = doc.querySelector('.changelog-banner__dismiss input[name="returnTo"]');
		expect(returnTo?.getAttribute("value")).toBe(`/blog/${slug}`);
	});
});

describe("HTML responses carry the Content-Signal header", () => {
	it("sets Content-Signal and Vary: Accept on a plain HTML GET", async () => {
		const response = await request(app).get(`/blog/${firstPost.slug}`);
		expect(response.headers["content-signal"]).toBe("search=yes, ai-input=yes, ai-train=no");
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});
