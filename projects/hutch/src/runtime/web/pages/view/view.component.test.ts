import assert from "node:assert/strict";
import { generateCspNonce } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { calculateReadTime } from "@packages/domain/article";
import { Base } from "../../base.component";
import { ViewPage, type ViewPageInput } from "./view.component";

const baseInput: ViewPageInput = {
	articleUrl: "https://example.com/post",
	appOrigin: "http://localhost:3000",
	metadata: {
		title: "Hello World",
		siteName: "example.com",
		excerpt: "A lovely article.",
		wordCount: 500,
		imageUrl: "https://cdn.example.com/hero.jpg",
	},
	estimatedReadTime: calculateReadTime(0),
	saveTip: { state: "due", html: "" },
	content: "<p>Body copy.</p>",
	summary: { status: "skipped" },
	actions: [
		{
			name: "Save to My Queue",
			href: "/save?url=https%3A%2F%2Fexample.com%2Fpost",
			variant: "primary",
		},
	],
};

const CSP_NONCE = generateCspNonce();

function render(input = baseInput) {
	const html = Base(ViewPage(input), { isAuthenticated: false, emailVerified: undefined, cspNonce: CSP_NONCE }).to("text/html").body;
	return new JSDOM(html).window.document;
}

describe("ViewPage", () => {
	it("leaves the meta row free of a provenance tag: a shared article belongs to no one reading it", () => {
		const meta = render().querySelector(".article-body__meta");
		assert(meta, "meta row must render");

		expect(Array.from(meta.querySelectorAll("span")).map((span) => span.textContent?.trim())).toEqual([
			"example.com",
			"1 min read",
		]);
	});

	it("renders the article body via the shared renderer", () => {
		const doc = render();

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
			"Hello World",
		);
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe(
			"example.com",
		);
		const content = doc.querySelector("[data-test-reader-content]");
		assert(content, "reader content must be rendered");
		expect(content.innerHTML.trim()).toBe("<p>Body copy.</p>");
	});

	it("points 'View original' at the redirect destination for a merged article", () => {
		const doc = render({
			...baseInput,
			articleUrl: "https://example.com/post.html",
			displayUrl: "https://example.com/post",
		});

		const link = doc.querySelector("[data-test-original-link]");
		assert(link, "header must render a 'View original' link");
		assert.equal(link.getAttribute("href"), "https://example.com/post");
	});

	it("marks the back slot as hidden on the view page", () => {
		const doc = render();

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered");
		expect(slot.classList.contains("article-body__back-slot--hidden")).toBe(
			true,
		);
	});

	it("marks the bottom back slot as hidden on the view page", () => {
		const doc = render();

		const slot = doc.querySelector("[data-test-back-bottom-slot]");
		assert(slot, "bottom back slot must be rendered");
		expect(
			slot.classList.contains("article-body__back-bottom-slot--hidden"),
		).toBe(true);
	});

	it("renders each action as an anchor with name and href from the model", () => {
		const doc = render({
			...baseInput,
			actions: [
				{ name: "Save to My Queue", href: "/save?url=x", variant: "primary" },
			],
		});

		const links = doc.querySelectorAll("[data-test-view-cta-action]");
		expect(links.length).toBe(1);
		const link = links[0];
		assert(link, "cta action link must be rendered");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/save?url=x");
		expect(link.textContent).toBe("Save to My Queue");
	});

	it("renders a 'Read in your queue' action when the model points to /queue/:id/view", () => {
		const doc = render({
			...baseInput,
			actions: [
				{
					name: "Read in your queue",
					href: "/queue/abc123/view",
					variant: "primary",
				},
			],
		});

		const link = doc.querySelector("[data-test-view-cta-action]");
		assert(link, "cta action link must be rendered");
		expect(link.getAttribute("href")).toBe("/queue/abc123/view");
		expect(link.textContent).toBe("Read in your queue");
	});

	it("renders multiple actions when the model has more than one", () => {
		const doc = render({
			...baseInput,
			actions: [
				{
					name: "Read in your queue",
					href: "/queue/abc/view",
					variant: "primary",
				},
				{
					name: "Save to My Queue",
					href: "/save?url=x",
					variant: "secondary",
				},
			],
		});

		const links = doc.querySelectorAll("[data-test-view-cta-action]");
		expect(links.length).toBe(2);
		expect(links[0]?.getAttribute("href")).toBe("/queue/abc/view");
		expect(links[1]?.getAttribute("href")).toBe("/save?url=x");
	});

	it("emits OG metadata using the article title and excerpt, with canonical pegged to the source and og:url pegged to the readplace wrapper so shares carry readplace's downloaded thumbnail + reader content", () => {
		const doc = render();

		const canonical = `https://example.com/post`;
		expect(
			doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
		).toBe("Hello World | Reader View");
		expect(
			doc
				.querySelector('meta[property="og:description"]')
				?.getAttribute("content"),
		).toBe("A lovely article.");
		expect(
			doc.querySelector('meta[property="og:image"]')?.getAttribute("content"),
		).toBe("https://cdn.example.com/hero.jpg");
		expect(
			doc
				.querySelector('meta[property="og:image:alt"]')
				?.getAttribute("content"),
		).toBe("Hello World");
		expect(
			doc.querySelector('meta[property="og:type"]')?.getAttribute("content"),
		).toBe("article");
		expect(
			doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
		).toBe("https://readplace.com/view/example.com/post");
		expect(
			doc
				.querySelector('meta[property="og:site_name"]')
				?.getAttribute("content"),
		).toBe("Readplace");
		expect(
			doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe(canonical);
	});

	it("emits Twitter Card metadata mirroring the article fields when imageUrl is set", () => {
		const doc = render();

		expect(
			doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
		).toBe("Hello World | Reader View");
		expect(
			doc
				.querySelector('meta[name="twitter:description"]')
				?.getAttribute("content"),
		).toBe("A lovely article.");
		expect(
			doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
		).toBe("https://cdn.example.com/hero.jpg");
	});

	it("uses the AI excerpt for og:description and twitter:description when summary is ready with an excerpt", () => {
		const doc = render({
			...baseInput,
			summary: {
				status: "ready",
				summary: "Long TL;DR that should not surface in social cards.",
				excerpt: "AI-curated excerpt.",
			},
		});

		expect(
			doc
				.querySelector('meta[property="og:description"]')
				?.getAttribute("content"),
		).toBe("AI-curated excerpt.");
		expect(
			doc
				.querySelector('meta[name="twitter:description"]')
				?.getAttribute("content"),
		).toBe("AI-curated excerpt.");
	});

	it("falls back to metadata.excerpt (not summary text) when summary is ready without an excerpt", () => {
		const doc = render({
			...baseInput,
			metadata: { ...baseInput.metadata, excerpt: "Fallback." },
			summary: {
				status: "ready",
				summary: "Long TL;DR that must not surface in social cards.",
			},
		});

		expect(
			doc
				.querySelector('meta[property="og:description"]')
				?.getAttribute("content"),
		).toBe("Fallback.");
		expect(
			doc
				.querySelector('meta[name="twitter:description"]')
				?.getAttribute("content"),
		).toBe("Fallback.");
	});

	it("falls back to the Readplace default images and alt when article has no imageUrl", () => {
		const { imageUrl: _unused, ...metadataNoImage } = baseInput.metadata;
		const doc = render({ ...baseInput, metadata: metadataNoImage });

		const ogImage = doc
			.querySelector('meta[property="og:image"]')
			?.getAttribute("content");
		const twitterImage = doc
			.querySelector('meta[name="twitter:image"]')
			?.getAttribute("content");
		expect(ogImage).toMatch(/og-image-1200x630\.png$/);
		expect(twitterImage).toMatch(/twitter-card-1200x600\.png$/);
		expect(
			doc
				.querySelector('meta[property="og:image:alt"]')
				?.getAttribute("content"),
		).toBe("Readplace — A read-it-later app");
	});

	it("falls back to 'View on Readplace.' description when excerpt is empty", () => {
		const doc = render({
			...baseInput,
			metadata: { ...baseInput.metadata, excerpt: "" },
		});

		expect(
			doc
				.querySelector('meta[property="og:description"]')
				?.getAttribute("content"),
		).toBe("View on Readplace.");
	});

	it("emits the default indexable robots meta so the reader page is open to crawlers", () => {
		const doc = render();

		expect(
			doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("index, follow");
	});

	it("emits JSON-LD Article whose url is the original source (not the /view wrapper)", () => {
		const doc = render();

		const script = doc.querySelector('script[type="application/ld+json"]');
		assert(script, "JSON-LD script must be rendered");
		const data = JSON.parse(script.textContent ?? "{}");
		expect(data["@type"]).toBe("Article");
		expect(data.headline).toBe("Hello World");
		expect(data.url).toBe("https://example.com/post");
		expect(data.isBasedOn).toBeUndefined();
		expect(data.image).toBe("https://cdn.example.com/hero.jpg");
	});

	it("omits JSON-LD image when article has no imageUrl", () => {
		const { imageUrl: _unused, ...metadataNoImage } = baseInput.metadata;
		const doc = render({ ...baseInput, metadata: metadataNoImage });

		const script = doc.querySelector('script[type="application/ld+json"]');
		assert(script, "JSON-LD script must be rendered");
		const data = JSON.parse(script.textContent ?? "{}");
		expect(data.image).toBeUndefined();
	});

	it("keeps a hostile crawled title inert inside the JSON-LD block (no script breakout)", () => {
		const hostileTitle = "</script><script>window.__pwned=true</script>";
		const doc = render({
			...baseInput,
			metadata: { ...baseInput.metadata, title: hostileTitle },
		});

		// If the title escaped the JSON-LD block, the script element would end at
		// the payload's closing tag and this parse would fail on truncated JSON.
		const ldJson = doc.querySelector('script[type="application/ld+json"]');
		assert(ldJson?.textContent, "JSON-LD script must survive HTML parsing as a single block");
		const data = JSON.parse(ldJson.textContent);
		assert.equal(data.headline, hostileTitle);

		const executableScripts = Array.from(doc.querySelectorAll("script")).filter(
			(script) => script.getAttribute("type") !== "application/ld+json",
		);
		const breakoutScripts = executableScripts.filter((script) =>
			(script.textContent ?? "").includes("__pwned"),
		);
		assert.equal(breakoutScripts.length, 0, "the payload must never become an executable script");
	});

	it("toggles the summary slot visibility based on status", () => {
		const skipped = render();
		const slotSkipped = skipped.querySelector("[data-test-reader-summary]");
		assert(slotSkipped, "summary slot must be rendered");
		// Skipped is a deliberate decision now, so the reader sees a visible info
		// card explaining why no summary was produced.
		expect(
			slotSkipped.classList.contains("article-body__summary-slot--visible"),
		).toBe(true);

		const crawlFailed = render({
			...baseInput,
			crawl: { status: "failed", reason: "blocked" },
		});
		const slotCrawlFailed = crawlFailed.querySelector(
			"[data-test-reader-summary]",
		);
		assert(slotCrawlFailed, "summary slot must be rendered");
		expect(
			slotCrawlFailed.classList.contains("article-body__summary-slot--hidden"),
		).toBe(true);

		const ready = render({
			...baseInput,
			summary: { status: "ready", summary: "Key points." },
		});
		const slotReady = ready.querySelector("[data-test-reader-summary]");
		assert(slotReady, "summary slot must be rendered");
		expect(
			slotReady.classList.contains("article-body__summary-slot--visible"),
		).toBe(true);
	});

	// The public /view reader intentionally keeps the TL;DR expanded — anonymous
	// visitors can't be measured per-cohort anyway, so there's no reason to gate
	// the summary behind a deliberate expand the way the internal reader does.
	it("renders the summary expanded by default on the public view", () => {
		const doc = render({
			...baseInput,
			summary: { status: "ready", summary: "Key points." },
		});
		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(true);
		// Public reader records no toggles, so the <details> carries no beacon URL.
		expect(details.hasAttribute("data-summary-toggle-url")).toBe(false);
	});

	it("renders the 'slow' reframe (source-link CTA) when content is undefined and there's no polling on the public view", () => {
		const doc = render({ ...baseInput, content: undefined });

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
		const link = doc.querySelector("[data-test-view-cta-action]");
		assert(link, "cta action must still be rendered without content");
	});

	describe("share URLs and SEO", () => {
		it("renders the share-balloon URLs against the supplied appOrigin, not a hardcoded host", () => {
			const doc = render({
				...baseInput,
				appOrigin: "https://staging.readplace.com",
			});

			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			assert.equal(shareUrl.origin, "https://staging.readplace.com");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			assert.equal(copyUrl.origin, "https://staging.readplace.com");
		});

		it("pegs the SEO canonical and JSON-LD url to the original source regardless of appOrigin (we disclaim the wrapper for attribution), and normalizes the readplace wrapper into og:url so the OG object identity always lives on the prod readplace host", () => {
			const doc = render({
				...baseInput,
				appOrigin: "https://staging.readplace.com",
			});

			const canonical = `https://example.com/post`;
			assert.equal(
				doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
				canonical,
			);
			assert.equal(
				doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
				"https://readplace.com/view/example.com/post",
			);
			const script = doc.querySelector('script[type="application/ld+json"]');
			assert(script, "JSON-LD script must be rendered");
			const data = JSON.parse(script.textContent ?? "{}");
			assert.equal(data.url, canonical);
		});
	});
});
