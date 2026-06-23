import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initBase } from "./base.component";
import { isChangelogVersion } from "./changelog-banner";
import type { BannerState } from "./banner-state";
import type { PageBody } from "./page-body.types";

const Base = initBase({ staticBaseUrl: "", liveReload: false });

const CHANGELOG_VERSION = "a1b2c3d4";
assert(isChangelogVersion(CHANGELOG_VERSION));

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
		expect(brand.getAttribute("href")).toBe("/?utm_source=header&utm_medium=internal&utm_content=brand");
	});

	it("should include page content in the body", () => {
		const page = createTestPageBody({ content: { html: "<main><h1>Hello World</h1></main>" } });
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const heading = doc.querySelector("main h1");
		expect(heading?.textContent).toBe("Hello World");
	});

	it("injects page-specific styles as a <style> element at the start of <main>", () => {
		const page = createTestPageBody({
			styles: ".lead { color: rebeccapurple; }",
			content: { html: "<main><p>Test content</p></main>" },
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const main = doc.querySelector("main");
		expect(main?.firstElementChild?.tagName).toBe("STYLE");
		expect(main?.querySelector("style")?.textContent).toBe(".lead { color: rebeccapurple; }");
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

		const button = doc.querySelector('[data-test-nav-item="import"]');
		assert(button, "Import Links nav item must be rendered for authenticated users");
		expect(button.textContent).toBe("Import Links");

		const form = button.closest("form");
		assert(form, "Import Links nav item must be wrapped in a form");
		expect(form.getAttribute("method")?.toUpperCase()).toBe("GET");
		const action = form.getAttribute("action");
		assert(action, "Import Links form must have an action");
		const url = new URL(action, "https://readplace.com");
		expect(url.pathname).toBe("/import");
		expect(url.searchParams.get("utm_source")).toBe("header-nav");
		expect(url.searchParams.get("utm_medium")).toBe("internal");
		expect(url.searchParams.get("utm_content")).toBe("import");
	});

	it("hides the Import Links nav item for unauthenticated requests", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: false, emailVerified: undefined }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(navItems).toEqual(["install", "features", "signup"]);
	});

	it("renders the Account nav item for authenticated full-access users", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const button = doc.querySelector('[data-test-nav-item="account"]');
		assert(button, "Account nav item must be rendered for authenticated users");
		expect(button.textContent).toBe("Account");
		const form = button.closest("form");
		assert(form, "Account nav item must be wrapped in a form");
		expect(form.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(form.getAttribute("action")).toBe("/account?utm_source=header-nav&utm_medium=internal&utm_content=account");
	});

	it("hides the Account nav item for unauthenticated requests", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: false, emailVerified: undefined }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(navItems).toEqual(["install", "features", "signup"]);
	});

	it("renders the full nav (queue + import + export + account + logout) for an authenticated full-access user", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			accessIsReadOnly: false,
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(navItems).toEqual(["queue", "import", "export", "account", "logout"]);
	});

	it("hides import + account from the nav for a read-only user (trial-expired / subscription-cancelled) — only queue, export, logout remain", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			accessIsReadOnly: true,
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(navItems).toEqual(["queue", "export", "logout"]);
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

	it("renders the changelog banner hidden by default (no announcement in state)", () => {
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-changelog-banner]");
		assert(banner, "changelog banner element must always be in the DOM");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("renders the changelog banner visible inside the banner area when state carries an announcement", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			...GUEST_STATE,
			changelogBanner: {
				hook: "I added keyboard shortcuts to the reader",
				href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
				version: CHANGELOG_VERSION,
			},
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const bannerArea = doc.querySelector(".banner-area");
		assert(bannerArea, "banner area must be rendered");
		const banner = bannerArea.querySelector("[data-test-changelog-banner]");
		assert(banner, "changelog banner must render inside the banner area");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.querySelector(".changelog-banner__hook")?.textContent).toBe(
			"I added keyboard shortcuts to the reader",
		);
	});

	it("threads currentPath into the changelog dismiss form so dismissing stays on the current page", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			...GUEST_STATE,
			currentPath: "/blog/keyboard-shortcuts",
			changelogBanner: {
				hook: "I added keyboard shortcuts to the reader",
				href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
				version: CHANGELOG_VERSION,
			},
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const returnTo = doc.querySelector('.changelog-banner__dismiss input[name="returnTo"]');
		assert(returnTo, "the dismiss form must carry the return path");
		expect(returnTo.getAttribute("value")).toBe("/blog/keyboard-shortcuts");
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

	function extractJsonLdBlock(html: string): string {
		const openTag = '<script type="application/ld+json">';
		const start = html.indexOf(openTag);
		assert(start >= 0, "JSON-LD script block must be rendered");
		const innerStart = start + openTag.length;
		const innerEnd = html.indexOf("</script>", innerStart);
		assert(innerEnd >= 0, "JSON-LD script block must be closed");
		return html.slice(innerStart, innerEnd);
	}

	it("escapes a </script> payload in structured data so it cannot terminate the JSON-LD block", () => {
		const hostileHeadline = "</script><script>alert(1)</script>";
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com",
				structuredData: [{ "@type": "Article", headline: hostileHeadline }],
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");

		// Everything up to the first real closing tag must be the complete JSON,
		// with the payload's tags emitted only in their JSON-escaped form.
		const inner = extractJsonLdBlock(result.body);
		expect(inner).toBe(
			'{"@type":"Article","headline":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}',
		);
		expect(JSON.parse(inner)).toEqual({ "@type": "Article", headline: hostileHeadline });
	});

	it("escapes <!-- and the U+2028/U+2029 line separators in structured data", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com",
				structuredData: [
					{
						"@type": "Article",
						headline: "line\u2028paragraph\u2029end",
						description: "<!-- sneaky comment -->",
					},
				],
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");

		const inner = extractJsonLdBlock(result.body);
		expect(inner).toBe(
			'{"@type":"Article","headline":"line\\u2028paragraph\\u2029end","description":"\\u003c!-- sneaky comment --\\u003e"}',
		);
	});

	it("round-trips structured data through escaping: parsing the JSON-LD block deep-equals the input", () => {
		const original = {
			"@context": "https://schema.org",
			"@type": "Article",
			headline: '</script><!--<script>alert(1)</script>-->',
			description: 'Ampersands & angle <brackets> with "quotes", back\\slashes and line\u2028paragraph\u2029separators',
			isBasedOn: { "@type": "Article", url: "https://example.com/a?b=1&c=<2>" },
			keywords: ["a<b", "c>d", "e&f"],
		};
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com",
				structuredData: [original],
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const ldJson = doc.querySelector('script[type="application/ld+json"]');
		assert(ldJson?.textContent, "JSON-LD script must survive HTML parsing as a single block");
		expect(JSON.parse(ldJson.textContent)).toEqual(original);
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

	it("should show the days-only countdown when a verification deadline is approaching", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: false,
			verification: { state: "counting-down", daysLeft: 3 },
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("counting-down");
		expect(banner.textContent).toContain("3 days");
		expect(banner.textContent).toContain("before your account is locked");
	});

	it("should switch to the locked contact-support copy once the account is locked", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: false,
			verification: { state: "locked" },
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("locked");
		expect(
			banner.querySelector(".verify-banner__contact")?.getAttribute("href"),
		).toBe("mailto:readplace+verification@readplace.com");
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

	it("preserves a cross-origin canonical (no readplace.com rewrite) when canonicalIsExternal is set", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://example.com/original-post",
				canonicalIsExternal: true,
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://example.com/original-post");
	});

	it("throws a clear invariant error when canonicalIsExternal is set with a relative URL (the branch tolerates only absolute http(s) URLs)", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "/relative-path",
				canonicalIsExternal: true,
			},
		});

		expect(() => Base(page, GUEST_STATE).to("text/html")).toThrow(
			/canonicalIsExternal requires an absolute http\(s\) URL/,
		);
	});

	it("defaults og:url to the canonical when seo.ogUrl is absent (keeps existing pages backward-compatible)", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://readplace.com/login",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/login");
		expect(
			doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
		).toBe("https://readplace.com/login");
	});

	it("decouples og:url from canonical when seo.ogUrl is set, normalizing the OG identity onto readplace.com while canonical stays on the external source", () => {
		const page = createTestPageBody({
			seo: {
				title: "T",
				description: "D",
				canonicalUrl: "https://example.com/original-post",
				canonicalIsExternal: true,
				ogUrl: "http://localhost:3000/view/example.com/original-post",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://example.com/original-post");
		expect(
			doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
		).toBe("https://readplace.com/view/example.com/original-post");
	});

	it("does not render the trial countdown when state.trial is undefined", () => {
		const page = createTestPageBody();
		const result = Base(page, { isAuthenticated: true, emailVerified: true }).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const headerContent = doc.querySelector(".header__content");
		assert(headerContent, "header content container must exist");
		const brand = headerContent.querySelector(".header__brand");
		assert(brand, "brand link must exist");
		const next = brand.nextElementSibling;
		assert(next, "an element must follow the brand inside .header__content");
		expect(next.tagName).toBe("NAV");
		expect(next.classList.contains("nav")).toBe(true);
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
		expect(countdown.textContent).toBe("13d 12h left in your free trial");
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

	it("renders the trial countdown as 'Subscription not active' and skips the client script when trial.state='expired'", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			trial: { state: "expired" },
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be rendered when trial.state='expired'");
		expect(countdown.textContent).toBe("Subscription not active");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.classList.contains("trial-countdown--expired")).toBe(true);

		expect(
			doc.querySelector('script[src$="/client-dist/trial-countdown.client.js"]'),
		).toBeNull();
	});

	it("renders the trial countdown as an anchor to /account so the user can fix the subscription state from any page", () => {
		const page = createTestPageBody();
		const result = Base(page, {
			isAuthenticated: true,
			emailVerified: true,
			trial: { state: "expired" },
		}).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be rendered");
		expect(countdown.tagName.toLowerCase()).toBe("a");
		expect(countdown.getAttribute("href")).toBe("/account?utm_source=header&utm_medium=internal&utm_content=trial-countdown");
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
				canonicalUrl: "/install?client=firefox",
			},
		});
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe("https://readplace.com/install?client=firefox");
	});
});

describe("initBase config", () => {
	it("prefixes static asset URLs with the configured staticBaseUrl", () => {
		const Base = initBase({ staticBaseUrl: "https://static.readplace.com", liveReload: false });
		const page = createTestPageBody();
		const result = Base(page, GUEST_STATE).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const icon = doc.querySelector('link[rel="icon"]');
		assert(icon, "favicon link must be rendered");
		expect(icon.getAttribute("href")?.startsWith("https://static.readplace.com")).toBe(true);
	});

	it("injects the livereload script only when liveReload is enabled", () => {
		const page = createTestPageBody();

		const withReload = initBase({ staticBaseUrl: "", liveReload: true })(page, GUEST_STATE).to("text/html");
		const withoutReload = initBase({ staticBaseUrl: "", liveReload: false })(page, GUEST_STATE).to("text/html");

		expect(withReload.body).toContain("livereload.js?snipver=1");
		expect(withoutReload.body).not.toContain("livereload.js?snipver=1");
	});

	it("appends siteScripts to every page when configured, and nothing when omitted", () => {
		const page = createTestPageBody();
		const marker = '<script src="/client-dist/webmcp.client.js" defer></script>';

		const withScripts = initBase({
			staticBaseUrl: "",
			liveReload: false,
			siteScripts: marker,
		})(page, GUEST_STATE).to("text/html");
		const withoutScripts = initBase({ staticBaseUrl: "", liveReload: false })(
			page,
			GUEST_STATE,
		).to("text/html");

		expect(withScripts.body).toContain(marker);
		expect(withoutScripts.body).not.toContain(marker);
	});
});
