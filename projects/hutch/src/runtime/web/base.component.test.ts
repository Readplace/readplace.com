import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Base } from "./base.component";
import type { BannerState } from "./banner-state";
import type { PageBody } from "./page-body.types";

function createTestPageBody(overrides: Partial<PageBody> = {}): PageBody {
	return {
		seo: {
			title: "Test Page",
			description: "Test description",
			canonicalUrl: "https://readplace.com/test",
		},
		styles: "",
		content: "<main><p>Test content</p></main>",
		...overrides,
	};
}

const GUEST_STATE: BannerState = { isAuthenticated: false, emailVerified: undefined };

describe("Base component", () => {
	it("should render a complete HTML page with the provided title", () => {
		const page = createTestPageBody({ seo: { title: "My Title", description: "Desc", canonicalUrl: "https://readplace.com" } });
		const result = Base(page, GUEST_STATE).to("text/html");

		expect(result.statusCode).toBe(200);
		const doc = new JSDOM(result.body).window.document;
		expect(doc.title).toBe("My Title");
	});

	it("should render the Readplace brand name in the header", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const brand = doc.querySelector(".header__brand") as HTMLAnchorElement;
		expect(brand.textContent).toBe("Readplace");
		expect(brand.getAttribute("href")).toBe("/");
	});

	it("should include page content in the body", () => {
		const page = createTestPageBody({ content: "<main><h1>Hello World</h1></main>" });
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const heading = doc.querySelector("main h1");
		expect(heading?.textContent).toBe("Hello World");
	});

	it("should apply bodyClass when provided", () => {
		const page = createTestPageBody({ bodyClass: "page-home" });
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.body.classList.contains("page-home")).toBe(true);
	});

	it("should include navigation links", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const navLinks = doc.querySelectorAll(".nav__link");
		expect(navLinks.length).toBeGreaterThan(0);
	});

	it("should render guest navigation when state is unauthenticated", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav container must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
	});

	it("should render authenticated navigation when state is authenticated", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav container must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
	});

	it("should include the footer with copyright", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const footer = doc.querySelector(".footer__copyright");
		expect(footer?.textContent).toContain("Readplace");
	});

	it("should include the offline banner", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector(".offline-banner");
		expect(banner?.getAttribute("aria-hidden")).toBe("true");
	});

	it("should set meta description from seo", () => {
		const page = createTestPageBody({ seo: { title: "T", description: "My desc", canonicalUrl: "https://readplace.com" } });
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const meta = doc.querySelector('meta[name="description"]');
		expect(meta?.getAttribute("content")).toBe("My desc");
	});

	it("renders markdown when text/markdown is requested, prefixing the title and description", () => {
		const page = createTestPageBody({
			seo: {
				title: "My Markdown Title",
				description: "Markdown description.",
				canonicalUrl: "https://readplace.com/test",
			},
			content: "<main><h2>Section</h2><p>Body copy.</p></main>",
		});

		const result = Base(page, GUEST_STATE).to("text/markdown");

		expect(result.statusCode).toBe(200);
		expect(result.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(result.body.startsWith("# My Markdown Title")).toBe(true);
		expect(result.body).toContain("Markdown description.");
		expect(result.body).toContain("Body copy.");
		expect(result.body).not.toContain("<main>");
	});

	it("uses markdownContent verbatim when provided, skipping HTML conversion", () => {
		const page = createTestPageBody({
			content: "<main><p>HTML body.</p></main>",
			markdownContent: "## Article\n\nClean prose.",
		});

		const result = Base(page, GUEST_STATE).to("text/markdown");

		expect(result.body).toContain("## Article");
		expect(result.body).toContain("Clean prose.");
		expect(result.body).not.toContain("HTML body.");
	});

	it("should render structured data when provided", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com",
				structuredData: [{ "@context": "https://schema.org", "@type": "WebSite", name: "Readplace" }],
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const ldJson = doc.querySelector('script[type="application/ld+json"]');
		const data = JSON.parse(ldJson?.textContent || "{}");
		expect(data.name).toBe("Readplace");
	});

	it("should show verification banner when authenticated and email not verified", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: false }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--visible")).toBe(true);
		expect(banner.textContent).toContain("Please verify your email");
	});

	it("should hide verification banner when email is verified", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("should hide verification banner when not authenticated", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: false, emailVerified: false }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("should hide verification banner when emailVerified is undefined", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: undefined }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("should rewrite relative canonical URLs to absolute readplace.com URLs", () => {
		const page = createTestPageBody({
			seo: { title: "T", description: "D", canonicalUrl: "/login" },
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/login");
		expect(
			doc
				.querySelector('meta[property="og:url"]')
				?.getAttribute("content"),
		).toBe("https://readplace.com/login");
	});

	it("should leave absolute readplace.com canonical URLs unchanged", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com/blog/my-post",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/blog/my-post");
	});

	it("should rewrite non-readplace hosts to readplace.com in canonical URLs", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://hutch-app.com/queue",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/queue");
	});

	it("should preserve query string when normalizing canonical URLs", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "/install?browser=firefox",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/install?browser=firefox");
	});
});
