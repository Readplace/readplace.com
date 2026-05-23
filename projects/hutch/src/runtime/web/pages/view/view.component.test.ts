import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { Base } from "../../base.component";
import { ViewPage, type ViewPageInput } from "./view.component";

const baseInput: ViewPageInput = {
	articleUrl: "https://example.com/post",
	metadata: {
		title: "Hello World",
		siteName: "example.com",
		excerpt: "A lovely article.",
		wordCount: 500,
		imageUrl: "https://cdn.example.com/hero.jpg",
	},
	estimatedReadTime: 3 as Minutes,
	content: "<p>Body copy.</p>",
	summary: { status: "skipped" },
	actions: [
		{
			name: "Save to My Queue",
			href: "/save?url=https%3A%2F%2Fexample.com%2Fpost",
			variant: "primary",
		},
	],
	expiresAt: null,
};

function render(input = baseInput) {
	const html = Base(ViewPage(input), { isAuthenticated: false, emailVerified: undefined }).to("text/html").body;
	return new JSDOM(html).window.document;
}

describe("ViewPage", () => {
	it("renders the article body via the shared renderer", () => {
		const doc = render();

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
			"Hello World",
		);
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe(
			"example.com",
		);
		const iframe = doc.querySelector("iframe[data-reader-iframe]");
		assert(iframe, "reader iframe must be rendered");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry srcdoc");
		const iframeDoc = new JSDOM(srcdoc).window.document;
		assert(iframeDoc.body, "iframe body must exist");
		expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Body copy.</p>");
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

	it("emits OG metadata using the article title and excerpt", () => {
		const doc = render();

		const canonical = `https://readplace.com/view/${encodeURIComponent("https://example.com/post")}`;
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
		).toBe(canonical);
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

	it("emits index,follow robots meta", () => {
		const doc = render();

		expect(
			doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("index, follow");
	});

	it("emits JSON-LD Article with isBasedOn attributed to the source URL", () => {
		const doc = render();

		const script = doc.querySelector('script[type="application/ld+json"]');
		assert(script, "JSON-LD script must be rendered");
		const data = JSON.parse(script.textContent ?? "{}");
		expect(data["@type"]).toBe("Article");
		expect(data.headline).toBe("Hello World");
		expect(data.isBasedOn).toEqual({
			"@type": "Article",
			url: "https://example.com/post",
		});
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

	it("renders the summary expanded by default on the public view", () => {
		const doc = render({
			...baseInput,
			summary: { status: "ready", summary: "Key points." },
		});
		const details = doc.querySelector(".article-body__summary");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(true);
	});

	it("renders the 'slow' reframe (source-link CTA) when content is undefined and there's no polling on the public view", () => {
		const doc = render({ ...baseInput, content: undefined });

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("slow");
		const link = doc.querySelector("[data-test-view-cta-action]");
		assert(link, "cta action must still be rendered without content");
	});

	describe("Public access expiry counter", () => {
		it("renders the counter element in state='permanent' (and no expires-at attribute) when the view does not expire", () => {
			const doc = render({ ...baseInput, expiresAt: null });

			const expiry = doc.querySelector("[data-test-view-expiry]");
			assert(expiry, "expiry element must always render so client JS can find it");
			expect(expiry.getAttribute("data-expiry-state")).toBe("permanent");
			expect(expiry.hasAttribute("data-expires-at")).toBe(false);
			expect(expiry.classList.contains("view__expiry--permanent")).toBe(true);
		});

		it("renders the counter in state='counting' with the SSR-correct initial text and an ISO data-expires-at when the view will expire", () => {
			const expiresAt = new Date(Date.now() + 60_000); // 1 minute in the future
			const doc = render({ ...baseInput, expiresAt });

			const expiry = doc.querySelector("[data-test-view-expiry]");
			assert(expiry, "expiry element must be rendered");
			expect(expiry.getAttribute("data-expiry-state")).toBe("counting");
			expect(expiry.getAttribute("data-expires-at")).toBe(expiresAt.toISOString());
			expect(expiry.textContent?.trim()).toMatch(
				/^Public access will expire in 0d 0h 0m 59s$|^Public access will expire in 0d 0h 1m 0s$/,
			);
		});

		it("renders the counter in state='expired' with a terminal message when expiresAt is in the past", () => {
			const expiresAt = new Date(Date.now() - 60_000);
			const doc = render({ ...baseInput, expiresAt });

			const expiry = doc.querySelector("[data-test-view-expiry]");
			assert(expiry, "expiry element must be rendered");
			expect(expiry.getAttribute("data-expiry-state")).toBe("expired");
			expect(expiry.textContent?.trim()).toBe("Public access has expired.");
		});

		it("marks any action with expirySaveLink=true via data-expiry-save-link so the client script can rewrite its utm_content as the counter ticks", () => {
			const doc = render({
				...baseInput,
				expiresAt: new Date(Date.now() + 60_000),
				actions: [
					{
						name: "Save to My Queue",
						href: "/save?url=x&utm_content=2d_4h_left",
						variant: "primary",
						expirySaveLink: true,
					},
					{
						name: "Paste another link",
						href: "/view?utm_source=view-article",
						variant: "secondary",
					},
				],
			});

			const links = doc.querySelectorAll("[data-test-view-cta-action]");
			expect(links.length).toBe(2);
			expect(links[0]?.hasAttribute("data-expiry-save-link")).toBe(true);
			expect(links[1]?.hasAttribute("data-expiry-save-link")).toBe(false);
		});

		it("loads the expiry-counter client bundle so the SSR counter ticks down once the page hydrates", () => {
			const doc = render({ ...baseInput, expiresAt: new Date(Date.now() + 60_000) });

			const script = doc.querySelector(
				'script[src$="/client-dist/expiry-counter.client.js"]',
			);
			assert(script, "expiry-counter client script must be rendered");
			expect(script.hasAttribute("defer")).toBe(true);
		});

		it("stamps the share balloon's utm_content with the visitor's sharerUserIdPrefix when provided so receiving views treat the link as a logged-in user's share", () => {
			const doc = render({ ...baseInput, sharerUserIdPrefix: "a3f1c2" });

			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			expect(shareUrl.searchParams.get("utm_content")).toBe("a3f1c2");
		});

		it("omits utm_content from the share balloon when no sharerUserIdPrefix is provided so anonymous shares fall back to standard expiry on the receiving page", () => {
			const doc = render(baseInput);

			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			expect(shareUrl.searchParams.get("utm_content")).toBeNull();
		});
	});
});
