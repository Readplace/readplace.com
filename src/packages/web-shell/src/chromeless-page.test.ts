import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initChromelessPage } from "./chromeless-page";
import type { ChromelessBannerState } from "./chromeless-page";
import { isChangelogVersion } from "./changelog-banner";
import { generateCspNonce } from "./csp-nonce.middleware";
import type { PageBody } from "./page-body.types";

const ChromelessPage = initChromelessPage({ staticBaseUrl: "https://static.example", liveReload: false });

const CHANGELOG_VERSION = "a1b2c3d4";
assert(isChangelogVersion(CHANGELOG_VERSION));

const CSP_NONCE = generateCspNonce();

const NO_BANNER: ChromelessBannerState = { cspNonce: CSP_NONCE };

const WITH_BANNER: ChromelessBannerState = {
	changelogBanner: {
		hook: "Highlights just landed.",
		href: "/blog/highlights",
		version: CHANGELOG_VERSION,
	},
	currentPath: "/queue/abc/view?platform=ios",
	cspNonce: CSP_NONCE,
};

function shellCss(state: ChromelessBannerState): string {
	const doc = new JSDOM(ChromelessPage(createTestPageBody(), state).to("text/html").body).window.document;
	return Array.from(doc.head.querySelectorAll("style"))
		.map((style) => style.textContent ?? "")
		.join("");
}

function createTestPageBody(overrides: Partial<PageBody> = {}): PageBody {
	return {
		seo: {
			title: "Reader",
			description: "An article",
			canonicalUrl: "https://readplace.com/queue/abc/view",
			robots: "noindex, nofollow",
		},
		styles: ".reader { color: rebeccapurple; }",
		content: { html: "<main class=\"reader\"><p>Body copy.</p></main>" },
		scripts: "<script src=\"/client-dist/progress-bar.client.js\" defer></script>",
		...overrides,
	};
}

describe("ChromelessPage", () => {
	it("pins the dark theme class on the body when the app supplies a dark appearance preference", () => {
		const result = ChromelessPage(createTestPageBody(), { cspNonce: CSP_NONCE, appearance: "dark" }).to(
			"text/html",
		);
		const doc = new JSDOM(result.body).window.document;

		expect(doc.body.classList.contains("theme-dark")).toBe(true);
	});

	it("pins the light theme class on the body when the app supplies a light appearance preference", () => {
		const result = ChromelessPage(createTestPageBody(), { cspNonce: CSP_NONCE, appearance: "light" }).to(
			"text/html",
		);
		const doc = new JSDOM(result.body).window.document;

		expect(doc.body.classList.contains("theme-light")).toBe(true);
	});

	it("stamps no theme class when the app supplies no appearance preference", () => {
		const result = ChromelessPage(createTestPageBody({ bodyClass: "page-account" }), NO_BANNER).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.body.classList.contains("page-account")).toBe(true);
		expect(doc.body.classList.contains("theme-light")).toBe(false);
		expect(doc.body.classList.contains("theme-dark")).toBe(false);
	});

	it("renders the page <main>, its styles, and htmx — with none of the web shell chrome", () => {
		const result = ChromelessPage(createTestPageBody(), NO_BANNER).to("text/html");

		expect(result.statusCode).toBe(200);
		const doc = new JSDOM(result.body).window.document;

		const main = doc.querySelector("main.reader");
		expect(main?.querySelector("p")?.textContent).toBe("Body copy.");
		expect(main?.querySelector("style")?.textContent).toContain("rebeccapurple");
		expect(doc.querySelector('script[src*="/client-dist/progress-bar.client.js"]')).not.toBeNull();
		const htmx = doc.querySelector('script[src="/client-dist/htmx.client.js"]');
		assert(htmx, "htmx must load from the same-origin client-dist mount");
		expect(htmx.hasAttribute("defer")).toBe(true);

		expect(doc.querySelector(".header")).toBeNull();
		expect(doc.querySelector(".nav")).toBeNull();
		expect(doc.querySelector(".footer")).toBeNull();
	});

	it("loads every script from this origin, with htmx's config on a <head> meta instead of an inline script", () => {
		const doc = new JSDOM(
			ChromelessPage(createTestPageBody(), NO_BANNER).to("text/html").body,
		).window.document;

		expect(
			Array.from(doc.querySelectorAll("script[src]")).map((script) => {
				const src = script.getAttribute("src");
				assert(src, "a script matched by [src] must carry a src");
				return src;
			}),
		).toEqual(["/client-dist/htmx.client.js", "/client-dist/progress-bar.client.js"]);

		const configMeta = doc.head.querySelector('meta[name="htmx-config"]');
		assert(configMeta, "htmx config must ride a <head> meta so htmx reads it at init");
		expect(JSON.parse(configMeta.getAttribute("content") ?? "")).toEqual({
			scrollBehavior: "smooth",
		});
	});

	it("carries the page's seo title, description, and robots into <head>", () => {
		const doc = new JSDOM(ChromelessPage(createTestPageBody(), NO_BANNER).to("text/html").body).window.document;
		expect(doc.title).toBe("Reader");
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("An article");
	});

	/* The in-app web sheet must not offer to open the app the user is already in. */
	it("carries only description and robots into <head>, even when the page declares more", () => {
		const page = createTestPageBody({
			seo: {
				title: "Reader",
				description: "An article",
				canonicalUrl: "https://readplace.com/queue/abc/view",
				robots: "noindex, nofollow",
				author: "Fayner Brack",
				keywords: "read it later",
				appleItunesApp: "app-id=6777107238",
			},
		});
		const doc = new JSDOM(ChromelessPage(page, NO_BANNER).to("text/html").body).window.document;

		expect(
			["description", "robots", "author", "keywords", "apple-itunes-app"].map((name) => [
				name,
				doc.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null,
			]),
		).toEqual([
			["description", "An article"],
			["robots", "noindex, nofollow"],
			["author", null],
			["keywords", null],
			["apple-itunes-app", null],
		]);
	});

	it("honours the PageBody status code", () => {
		const result = ChromelessPage(createTestPageBody({ statusCode: 404 }), NO_BANNER).to("text/html");
		expect(result.statusCode).toBe(404);
	});

	it("renders only the shell's own htmx script when the page declares none", () => {
		const doc = new JSDOM(
			ChromelessPage(createTestPageBody({ scripts: undefined }), NO_BANNER).to("text/html").body,
		).window.document;
		expect(
			Array.from(doc.querySelectorAll('script[src*="/client-dist/"]')).map((script) => {
				const src = script.getAttribute("src");
				assert(src, "a script matched by [src*='/client-dist/'] must carry a src");
				return src;
			}),
		).toEqual(["/client-dist/htmx.client.js"]);
	});

	it("injects the dev livereload script only when liveReload is enabled", () => {
		const live = initChromelessPage({ staticBaseUrl: "https://static.example", liveReload: true });
		const doc = new JSDOM(live(createTestPageBody(), NO_BANNER).to("text/html").body).window.document;
		expect(doc.querySelector('script[src*="livereload.js"]')).not.toBeNull();
	});

	it("appends the site's own scripts after the page's, so a chromeless page still gets what the whole site relies on", () => {
		const withSite = initChromelessPage({
			staticBaseUrl: "https://static.example",
			liveReload: true,
			siteScripts: `<script src="/client-dist/local-time.client.js" defer></script>`,
		});

		const body = withSite(createTestPageBody(), NO_BANNER).to("text/html").body;
		const doc = new JSDOM(body).window.document;
		expect(doc.querySelector('script[src*="/client-dist/local-time.client.js"]')).not.toBeNull();

		const order = Array.from(doc.querySelectorAll("script"))
			.map((script) => script.getAttribute("src") ?? "")
			.filter((src) => src.length > 0);
		const page = order.findIndex((src) => src.includes("progress-bar.client.js"));
		const site = order.findIndex((src) => src.includes("local-time.client.js"));
		const liveReload = order.findIndex((src) => src.includes("livereload.js"));
		expect(page).toBeLessThan(site);
		expect(site).toBeLessThan(liveReload);
	});

	it("hides the changelog banner when there is no announcement", () => {
		const doc = new JSDOM(ChromelessPage(createTestPageBody(), NO_BANNER).to("text/html").body).window.document;

		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the shell always emits the banner element so visibility is a class, not a presence check");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("renders the announcement above <main> so it scrolls away instead of covering the article", () => {
		const doc = new JSDOM(ChromelessPage(createTestPageBody(), WITH_BANNER).to("text/html").body).window.document;

		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the announcement must render");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.querySelector(".changelog-banner__hook")?.textContent).toBe("Highlights just landed.");
		expect(banner.querySelector(".changelog-banner__link")?.getAttribute("href")).toBe("/blog/highlights");

		expect(doc.querySelector(".banner-area")).toBeNull();
		const main = doc.querySelector("main.reader");
		assert(main, "the article must render");
		expect(banner.compareDocumentPosition(main) & banner.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("dismisses through the same no-JS form the web shell uses, returning to the article it was shown on", () => {
		const doc = new JSDOM(ChromelessPage(createTestPageBody(), WITH_BANNER).to("text/html").body).window.document;

		const form = doc.querySelector("form.changelog-banner__dismiss");
		assert(form, "the close control must be a real form so it works with no JS and stays inside the app sheet");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe("/banner/changelog/dismiss?utm_source=changelog-banner&utm_medium=internal&utm_content=dismiss");
		expect(form.querySelector('input[name="version"]')?.getAttribute("value")).toBe(CHANGELOG_VERSION);
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			"/queue/abc/view?platform=ios",
		);
	});

	it("styles the announcement without pulling in the full shell's fixed banner-area positioning", () => {
		const css = shellCss(WITH_BANNER);

		expect(css).toContain(".changelog-banner--hidden");
		expect(css).not.toContain(".banner-area {");
	});

	it("reserves no space for a fixed banner bar, since this shell has none", () => {
		expect(shellCss(NO_BANNER)).toContain("--banner-area-height: 0px");
	});

	it("ships the shared button system, so a page's .btn markup is a button here as it is under the full shell", () => {
		const css = shellCss(NO_BANNER);

		expect(css).toContain(".btn {");
		expect(css).toContain(".btn--primary {");
		expect(css).toContain(".btn--secondary {");
	});

	it("paints its own ground under its ink, so the page stays legible over a host surface that resolved a different scheme", () => {
		const bodyRule = shellCss(NO_BANNER).match(/\bbody\s*\{([^}]*)\}/);
		assert(bodyRule, "the shared reset must style the body");

		expect(bodyRule[1]).toContain("color: var(--foreground)");
		expect(bodyRule[1]).toContain("background: var(--background)");
	});

	it("stamps the request's nonce on every inline script and style this shell emits", () => {
		const doc = new JSDOM(
			ChromelessPage(createTestPageBody(), WITH_BANNER).to("text/html").body,
		).window.document;

		expect({
			script: Array.from(doc.querySelectorAll("script:not([src])")).map((el) =>
				el.getAttribute("nonce"),
			),
			style: Array.from(doc.querySelectorAll("style")).map((el) => el.getAttribute("nonce")),
		}).toEqual({
			script: [CSP_NONCE],
			style: [CSP_NONCE, CSP_NONCE],
		});
	});
});
