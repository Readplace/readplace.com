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
		content: { html: "<main><p>Test content</p></main>" },
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
		const page = createTestPageBody({ content: { html: "<main><h1>Hello World</h1></main>" } });
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

	it("renders the Import Links nav item for an authenticated request, tagged for funnel attribution", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const link = doc.querySelector('[data-test-nav-item="import"]');
		assert(link, "Import Links nav item must be rendered for authenticated users");
		expect(link.textContent).toBe("Import Links");

		const href = link.getAttribute("href");
		assert(href, "Import Links nav item must have an href");
		const url = new URL(href, "https://readplace.com");
		expect(url.pathname).toBe("/import");
		expect(url.searchParams.get("utm_source")).toBe("header-nav");
		expect(url.searchParams.get("utm_medium")).toBe("internal");
		expect(url.searchParams.get("utm_content")).toBe("import-link");
	});

	it("hides the Import Links nav item for unauthenticated requests", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: false, emailVerified: undefined }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.querySelector('[data-test-nav-item="import"]')).toBeNull();
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

	it("renders the extension suggestion banner element with data-show='false' by default", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-extension-suggestion-banner]");
		assert(banner, "extension suggestion banner must always be in the DOM");
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("false");
	});

	it("sets data-show='true' on the extension suggestion banner when state asks for it", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			showExtensionSuggestionBanner: true,
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-extension-suggestion-banner]");
		assert(banner, "extension suggestion banner must always be in the DOM");
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("true");
	});

	it("loads the extension suggestion banner client bundle", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const script = doc.querySelector(
			'script[src$="/client-dist/extension-suggestion-banner.client.js"]',
		);
		assert(script, "extension suggestion banner client script must be rendered");
		expect(script.hasAttribute("defer")).toBe(true);
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
			content: { html: "<main><h2>Section</h2><p>Body copy.</p></main>" },
		});

		const result = Base(page, GUEST_STATE).to("text/markdown");

		expect(result.statusCode).toBe(200);
		expect(result.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(result.body.startsWith("# My Markdown Title")).toBe(true);
		expect(result.body).toContain("Markdown description.");
		expect(result.body).toContain("Body copy.");
		expect(result.body).not.toContain("<main>");
	});

	it("uses markdown content verbatim when provided, skipping HTML conversion", () => {
		const page = createTestPageBody({
			content: { html: "<main><p>HTML body.</p></main>", markdown: "## Article\n\nClean prose." },
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

	it("does not render the trial countdown when state.trial is undefined", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.querySelector("[data-test-trial-countdown]")).toBeNull();
		expect(
			doc.querySelector('script[src$="/client-dist/trial-countdown.client.js"]'),
		).toBeNull();
	});

	it("renders the trial countdown with text/data-attrs and includes the client script when trial.state='active'", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			trial: {
				state: "active",
				endsAtIso: "2026-01-15T00:00:00.000Z",
				serverNowIso: "2026-01-01T00:00:00.000Z",
				remaining: {
					days: 13,
					hours: 12,
					minutes: 33,
					seconds: 22,
					totalMs: 1,
				},
				escalation: "moderate",
			},
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be rendered when trial.state='active'");
		expect(countdown.textContent).toBe("13d 12h 33m 22s in your free trial");
		expect(countdown.getAttribute("data-trial-state")).toBe("active");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe("2026-01-15T00:00:00.000Z");
		expect(countdown.getAttribute("data-server-now-iso")).toBe("2026-01-01T00:00:00.000Z");
		expect(countdown.classList.contains("trial-countdown--moderate")).toBe(true);
		expect(countdown.getAttribute("role")).toBe("timer");
		expect(countdown.getAttribute("aria-live")).toBe("off");

		const script = doc.querySelector(
			'script[src$="/client-dist/trial-countdown.client.js"]',
		);
		assert(script, "trial countdown client script must load when state='active'");
		expect(script.hasAttribute("defer")).toBe(true);
	});

	it("renders the trial countdown as 'Free trial is over!' and skips the client script when trial.state='expired'", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			trial: { state: "expired" },
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be rendered when trial.state='expired'");
		expect(countdown.textContent).toBe("Free trial is over!");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.classList.contains("trial-countdown--expired")).toBe(true);

		expect(
			doc.querySelector('script[src$="/client-dist/trial-countdown.client.js"]'),
		).toBeNull();
	});

	it("places the trial countdown directly after the header brand inside .header__content", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			trial: {
				state: "active",
				endsAtIso: "2026-01-15T00:00:00.000Z",
				serverNowIso: "2026-01-01T00:00:00.000Z",
				remaining: { days: 13, hours: 12, minutes: 33, seconds: 22, totalMs: 1 },
				escalation: "soft",
			},
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const headerContent = doc.querySelector(".header__content");
		assert(headerContent, "header content container must exist");
		const brand = headerContent.querySelector(".header__brand");
		assert(brand, "brand link must exist");
		const next = brand.nextElementSibling;
		assert(next, "an element must follow the brand inside .header__content");
		expect(next.hasAttribute("data-test-trial-countdown")).toBe(true);
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
