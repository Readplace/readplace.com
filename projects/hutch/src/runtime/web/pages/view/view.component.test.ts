import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { calculateReadTime } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { Base } from "../../base.component";
import { buildExpiryFields, ViewPage, type ViewPageInput } from "./view.component";
import { sharedUserIdFrom } from "./view-expiry";

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
	now: new Date("2026-05-01T00:00:00.000Z"),
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

	it("emits noindex robots meta so the wrapper is not indexed as a scraper proxy", () => {
		const doc = render();

		expect(
			doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("noindex, follow");
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

	describe("expiry counter", () => {
		const now = new Date("2026-05-01T00:00:00.000Z");

		it("renders state=permanent with no counter text when expiresAt is null", () => {
			const doc = render({ ...baseInput, expiresAt: null, now });

			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			assert.equal(counter.getAttribute("data-expiry-state"), "permanent");
			assert.equal(counter.getAttribute("data-expires-at"), null);
			assert(
				counter.classList.contains("view__expiry--permanent"),
				"permanent state must apply the hidden CSS modifier",
			);
			assert.equal(counter.textContent, "");
		});

		it("renders state=counting with the SSR countdown text when expiresAt is in the future", () => {
			const expiresAt = new Date("2026-05-03T10:05:33.000Z");
			const doc = render({ ...baseInput, expiresAt, now });

			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			assert.equal(counter.getAttribute("data-expiry-state"), "counting");
			assert.equal(
				counter.getAttribute("data-expires-at"),
				"2026-05-03T10:05:33.000Z",
			);
			assert(
				counter.classList.contains("view__expiry--counting"),
				"counting state must apply the counting CSS modifier",
			);
			assert.equal(counter.textContent, "Public access will expire in 2d 10h 5m 33s");
		});

		it("renders state=expired with the expired copy when expiresAt is at or before now", () => {
			const expiresAt = new Date("2026-04-30T23:59:59.000Z");
			const doc = render({ ...baseInput, expiresAt, now });

			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			assert.equal(counter.getAttribute("data-expiry-state"), "expired");
			assert(
				counter.classList.contains("view__expiry--expired"),
				"expired state must apply the expired CSS modifier",
			);
			assert.equal(counter.textContent, "Public access has expired.");
		});

		it("boots the expiry-counter client via the external script bundle", () => {
			const doc = render({ ...baseInput, expiresAt: null, now });

			const script = doc.querySelector(
				'script[src$="/client-dist/expiry-counter.client.js"]',
			);
			assert(script, "expiry-counter client script must be rendered");
			assert(script.hasAttribute("defer"));
		});

		it("adds data-expiry-save-link to actions where expirySaveLink is true", () => {
			const doc = render({
				...baseInput,
				actions: [
					{
						name: "Save to My Queue",
						href: "/save?url=https%3A%2F%2Fexample.com%2Fpost&utm_content=2d_10h_left",
						variant: "primary",
						expirySaveLink: true,
					},
					{
						name: "Paste another link",
						href: "/view?utm_source=view-article",
						variant: "secondary",
					},
				],
				expiresAt: new Date("2026-05-03T10:05:33.000Z"),
				now,
			});

			const actions = doc.querySelectorAll("[data-test-view-cta-action]");
			assert.equal(actions.length, 2);
			assert(actions[0]?.hasAttribute("data-expiry-save-link"));
			assert.equal(actions[1]?.hasAttribute("data-expiry-save-link"), false);
		});

		it("omits data-expiry-save-link when expirySaveLink is undefined", () => {
			const doc = render({
				...baseInput,
				actions: [
					{
						name: "Save to My Queue",
						href: "/save?url=x",
						variant: "primary",
					},
				],
				expiresAt: null,
				now,
			});

			const action = doc.querySelector("[data-test-view-cta-action]");
			assert(action, "cta action must be rendered");
			assert.equal(action.hasAttribute("data-expiry-save-link"), false);
		});

		it("stamps utm_content on share-balloon URLs with the sharerUserIdPrefix when provided", () => {
			const userId = UserIdSchema.parse("abc123deadbeef1234567890abcdef01");
			const doc = render({
				...baseInput,
				sharerUserIdPrefix: sharedUserIdFrom(userId),
			});

			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			assert.equal(shareUrl.searchParams.get("utm_content"), "abc123");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			assert.equal(copyUrl.searchParams.get("utm_content"), "abc123");
		});

		it("omits utm_content from share-balloon URLs when no sharerUserIdPrefix is provided", () => {
			const doc = render(baseInput);

			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			assert.equal(shareUrl.searchParams.get("utm_content"), null);
		});

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

	describe("public access paywall", () => {
		const now = new Date("2026-05-01T00:00:00.000Z");
		const readyInput: ViewPageInput = {
			...baseInput,
			crawl: { status: "ready" },
		};

		it("ships the paywall hidden on load carrying the expiry deadline for an expired, ready article", () => {
			const expiresAt = new Date("2026-04-30T23:59:59.000Z");
			const doc = render({ ...readyInput, expiresAt, now });

			const paywall = doc.querySelector("[data-test-view-paywall]");
			assert(paywall, "paywall must be rendered for an expired ready article");
			assert.equal(paywall.getAttribute("data-paywall-active"), "false");
			assert(
				paywall.classList.contains("view__paywall--inactive"),
				"the paywall always ships hidden — the client owns the scroll-gated reveal",
			);
			assert.equal(
				paywall.classList.contains("view__paywall--active"),
				false,
				"the SSR paywall must not be pre-revealed",
			);
			assert.equal(
				paywall.getAttribute("data-expires-at"),
				"2026-04-30T23:59:59.000Z",
			);

			const heading = paywall.querySelector("#view-paywall-heading");
			assert(heading, "paywall heading must be rendered");
			assert.equal(heading.textContent, "Public access expired");

			const body = paywall.querySelector(".view__paywall-body");
			assert(body, "paywall body must be rendered");
			assert.equal(
				body.textContent,
				"Save this link to your readplace queue and read every link without expiration.",
			);

			const save = paywall.querySelector("[data-test-view-paywall-save]");
			assert(save, "paywall save button must be rendered");
			assert.equal(
				save.getAttribute("href"),
				"/save?url=https%3A%2F%2Fexample.com%2Fpost",
			);
			assert.equal(save.textContent, "Save to My Queue");
		});

		it("ships the paywall hidden carrying the deadline while the article is still counting down", () => {
			const expiresAt = new Date("2026-05-03T10:05:33.000Z");
			const doc = render({ ...readyInput, expiresAt, now });

			const paywall = doc.querySelector("[data-test-view-paywall]");
			assert(
				paywall,
				"paywall element must be present while counting so the client can reveal it live",
			);
			assert.equal(paywall.getAttribute("data-paywall-active"), "false");
			assert(
				paywall.classList.contains("view__paywall--inactive"),
				"counting paywall must apply the inactive modifier",
			);
			assert.equal(
				paywall.getAttribute("data-expires-at"),
				"2026-05-03T10:05:33.000Z",
			);
		});

		it("boots the view-paywall client via the external script bundle", () => {
			const expiresAt = new Date("2026-04-30T23:59:59.000Z");
			const doc = render({ ...readyInput, expiresAt, now });

			const script = doc.querySelector(
				'script[src$="/client-dist/view-paywall.client.js"]',
			);
			assert(script, "view-paywall client script must be rendered");
			assert(script.hasAttribute("defer"));
		});

		it("omits the paywall when the crawl is not ready, even after access expires", () => {
			const expiresAt = new Date("2026-04-30T23:59:59.000Z");
			const doc = render({
				...baseInput,
				crawl: { status: "failed", reason: "blocked" },
				expiresAt,
				now,
			});

			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			assert.equal(slot.getAttribute("data-reader-status"), "failed");

			assert.equal(doc.querySelectorAll("[data-test-view-paywall]").length, 0);
		});

		it("omits the paywall for a permanent (non-expiring) article", () => {
			const doc = render({ ...readyInput, expiresAt: null, now });

			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			assert.equal(counter.getAttribute("data-expiry-state"), "permanent");

			assert.equal(doc.querySelectorAll("[data-test-view-paywall]").length, 0);
		});
	});
});

describe("buildExpiryFields", () => {
	const now = new Date("2026-05-01T00:00:00.000Z");

	it("returns permanent for expiresAt=null", () => {
		assert.deepStrictEqual(buildExpiryFields(null, now), {
			state: "permanent",
			message: "",
		});
	});

	it("returns counting with the countdown text and ISO timestamp when expiresAt > now", () => {
		const expiresAt = new Date("2026-05-03T10:05:33.000Z");
		assert.deepStrictEqual(buildExpiryFields(expiresAt, now), {
			state: "counting",
			message: "Public access will expire in 2d 10h 5m 33s",
			expiresAtIso: "2026-05-03T10:05:33.000Z",
		});
	});

	it("returns expired when expiresAt <= now", () => {
		const expiresAt = new Date("2026-04-30T23:59:59.000Z");
		assert.deepStrictEqual(buildExpiryFields(expiresAt, now), {
			state: "expired",
			message: "Public access has expired.",
			expiresAtIso: "2026-04-30T23:59:59.000Z",
		});
	});

	it("returns expired exactly at the boundary (expiresAt === now)", () => {
		assert.equal(buildExpiryFields(now, now).state, "expired");
	});
});
