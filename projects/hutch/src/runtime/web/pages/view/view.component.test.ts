import assert from "node:assert/strict";
import { generateCspNonce } from "@packages/web-shell";
import { toAbsoluteDate, toAbsoluteTime } from "@packages/web-shell/local-time.format";
import { JSDOM } from "jsdom";
import { calculateReadTime } from "@packages/domain/article";
import { Base } from "../../base.component";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import {
	ViewPage,
	renderViewCtaActionOob,
	type ViewAction,
	type ViewPageInput,
} from "./view.component";
import { articleBody } from "@packages/test-fixtures";

const baseInput: ViewPageInput = {
	articleUrl: "https://example.com/post",
	destinationUrl: destinationUrl("https://example.com/post"),
	appOrigin: "http://localhost:3000",
	metadata: {
		title: "Hello World",
		siteName: siteLabel("example.com"),
		excerpt: "A lovely article.",
		wordCount: 500,
		imageUrl: "https://cdn.example.com/hero.jpg",
	},
	estimatedReadTime: calculateReadTime(500),
	saveTip: { state: "due", html: "" },
	content: articleBody("<p>Body copy.</p>"),
	summary: { status: "skipped" },
	actions: [
		{
			key: "save",
			name: "Save to My Readlist",
			shortName: "Save",
			href: "/save?url=https%3A%2F%2Fexample.com%2Fpost",
			variant: "primary",
		},
	],
	backLink: undefined,
};

const CSP_NONCE = generateCspNonce();

function render(input = baseInput) {
	const html = Base(ViewPage(input), { isAuthenticated: false, emailVerified: undefined, cspNonce: CSP_NONCE }).to("text/html").body;
	return new JSDOM(html).window.document;
}

describe("ViewPage", () => {
	it("leaves the meta row free of a saved time and provenance: a shared article belongs to no one reading it", () => {
		const facts = Array.from(render().querySelectorAll("[data-test-reader-fact]"), (fact) => [
			fact.getAttribute("data-test-reader-fact"),
			fact.textContent?.trim(),
		]);

		expect(facts).toEqual([
			["site", "example.com"],
			["read-time", "3 min read"],
			["original", "Original article"],
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

	it("points the Original link at the redirect destination for a merged article", () => {
		const doc = render({
			...baseInput,
			articleUrl: "https://example.com/post.html",
			destinationUrl: destinationUrl("https://example.com/post"),
		});

		const link = doc.querySelector("[data-test-original-link]");
		assert(link, "header must render an Original link");
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

	it("renders the toolbar only, with no bottom bar", () => {
		const doc = render();

		expect(Array.from(doc.querySelectorAll(".article-body__actions"), (bar) => bar.className)).toEqual([
			"article-body__actions article-body__actions--top",
		]);
	});

	it("gives a signed-in viewer a Back to readlist link", () => {
		const doc = render({
			...baseInput,
			backLink: { topHref: "/queue?utm_source=view-article&utm_content=back-to-queue", label: "Back to readlist" },
		});

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered");
		expect(slot.classList.contains("article-body__back-slot--visible")).toBe(true);
		const link = slot.querySelector("[data-test-back-link]");
		assert(link, "a signed-in viewer's back slot must hold the back link");
		expect([link.getAttribute("href"), link.textContent?.trim()]).toEqual([
			"/queue?utm_source=view-article&utm_content=back-to-queue",
			"Back to readlist",
		]);
	});

	it("renders each action as an anchor with name and href from the model", () => {
		const doc = render({
			...baseInput,
			actions: [
				{ key: "save", name: "Save to My Readlist", shortName: "Save", href: "/save?url=x", variant: "primary" },
			],
		});

		const links = doc.querySelectorAll("[data-test-view-cta-action]");
		expect(links.length).toBe(1);
		const link = links[0];
		assert(link, "cta action link must be rendered");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/save?url=x");
		expect(link.querySelector(".view__cta-label")?.textContent).toBe("Save to My Readlist");
		expect([link.classList.contains("btn--primary"), link.classList.contains("btn--xl")]).toEqual([true, true]);
	});

	it("gives each action a stable id derived from its key so an OOB swap can target it", () => {
		const doc = render({
			...baseInput,
			actions: [
				{ key: "save", name: "Save to My Readlist", shortName: "Save", href: "/save?url=x", variant: "primary" },
			],
		});

		const link = doc.querySelector("[data-test-view-cta-action]");
		assert(link, "cta action link must be rendered");
		expect(link.id).toBe("view-cta-save");
	});

	it("renders multiple actions when the model has more than one, and nothing else in the bar", () => {
		const doc = render({
			...baseInput,
			actions: [
				{
					key: "paste-another-link",
					name: "Paste another link",
					shortName: "Paste",
					href: "/?utm_source=view-article",
					variant: "neutral",
				},
				{
					key: "save",
					name: "Save to My Readlist",
					shortName: "Save",
					href: "/save?url=x",
					variant: "primary",
				},
			],
			epubDownloadHref: "/view/example.com/a?format=epub",
		});

		expect(
			Array.from(doc.querySelectorAll("[data-test-view-cta] .view__cta-content > *"), (item) =>
				Array.from(item.children, (action) => [action.id, action.getAttribute("href")]),
			),
		).toEqual([
			[["view-cta-paste-another-link", "/?utm_source=view-article"]],
			[["view-cta-save", "/save?url=x"]],
		]);
	});

	it("offers Download in the toolbar as one direct EPUB link once the article has text", () => {
		const doc = render({ ...baseInput, epubDownloadHref: "/view/example.com/a?format=epub" });

		const slot = doc.querySelector(".article-body__toolbar [data-test-downloads-slot]");
		assert(slot, "the toolbar's Download slot must render");
		expect(slot.classList.contains("article-body__downloads-slot--visible")).toBe(true);
		expect(
			Array.from(slot.querySelectorAll("[data-test-download]"), (link) => [
				link.getAttribute("data-test-download"),
				link.getAttribute("href"),
			]),
		).toEqual([["epub", "/view/example.com/a?format=epub"]]);
	});

	it("keeps the toolbar's Download slot hidden and empty while the article has no text", () => {
		const doc = render({ ...baseInput, epubDownloadHref: undefined });

		const slot = doc.querySelector(".article-body__toolbar [data-test-downloads-slot]");
		assert(slot, "the toolbar's Download slot must render");
		expect([slot.classList.contains("article-body__downloads-slot--hidden"), slot.children.length]).toEqual([true, 0]);
	});

	describe("save-tip gating attribute", () => {
		const SAVE_ACTION: ViewAction = {
			key: "save",
			name: "Save to My Readlist",
			shortName: "Save",
			href: "/save?url=x",
			variant: "primary",
		};

		it("carries data-save-tip when the action's saveTipState is set", () => {
			const doc = render({
				...baseInput,
				actions: [{ ...SAVE_ACTION, saveTipState: "due" }],
			});

			const link = doc.querySelector("[data-test-view-cta-action]");
			assert(link, "cta action must be rendered");
			expect(link.getAttribute("data-save-tip")).toBe("due");
		});

		it("omits data-save-tip when the action carries no saveTipState", () => {
			const doc = render({ ...baseInput, actions: [SAVE_ACTION] });

			const link = doc.querySelector("[data-test-view-cta-action]");
			assert(link, "cta action must be rendered");
			expect(link.hasAttribute("data-save-tip")).toBe(false);
		});

		it("renders the inline action without an hx-swap-oob envelope", () => {
			const doc = render({ ...baseInput, actions: [SAVE_ACTION] });

			const link = doc.querySelector("[data-test-view-cta-action]");
			assert(link, "cta action must be rendered");
			expect(link.hasAttribute("hx-swap-oob")).toBe(false);
		});

		it("wraps the OOB action in an hx-swap-oob=outerHTML envelope carrying the id and save-tip state", () => {
			const dom = new JSDOM(
				`<!doctype html><html><body>${renderViewCtaActionOob({ ...SAVE_ACTION, saveTipState: "due" })}</body></html>`,
			);
			const link = dom.window.document.querySelector("[data-test-view-cta-action]");
			assert(link, "cta action must be rendered");
			expect(link.id).toBe("view-cta-save");
			expect(link.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(link.getAttribute("data-save-tip")).toBe("due");
			expect([link.classList.contains("btn--primary"), link.classList.contains("btn--xl")]).toEqual([true, true]);
		});
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

	it("emits noindex robots meta so a copy of someone else's article stays out of search results", () => {
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
			crawl: { status: "failed", outcomeRevision: 1, reason: "blocked" },
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

	it("renders the summary collapsed by default on the public view", () => {
		const doc = render({
			...baseInput,
			summary: { status: "ready", summary: "Key points." },
		});
		const details = doc.querySelector(".tldr-disclosure");
		assert(details, "summary details element must be rendered");
		expect(details.hasAttribute("open")).toBe(false);
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

	it("lays the article column alone in the main track, beside an Article details rail that opens with the table of contents", () => {
		const doc = render();

		const main = doc.querySelector("main.view > .reading-layout > .reading-layout__main");
		assert(main, "the main track must sit inside the reading layout");
		expect(Array.from(main.children, (child) => child.hasAttribute("data-article-body"))).toEqual([true]);
		expect(
			Array.from(doc.querySelectorAll("main.view > :not(style)"), (child) => [child.className, child.id, child.getAttribute("data-test-confirm-popover")]),
		).toEqual([
			["reading-layout", "", null],
			["confirm-popover", "reader-share", "share"],
		]);
		const layout = doc.querySelector("main.view > .reading-layout");
		assert(layout, "the reading layout must be rendered");
		expect(Array.from(layout.children, (child) => [child.tagName, child.className])).toEqual([
			["DIV", "reading-layout__main"],
			["ASIDE", "reading-layout__rail"],
		]);
		const rail = layout.querySelector(":scope > [data-test-reader-rail]");
		assert(rail, "the rail must sit beside the main track");
		expect([
			rail.getAttribute("aria-label"),
			Array.from(rail.children, (child) => [child.id, child.getAttribute("data-test-table-of-contents")]),
		]).toEqual(["Article details", [["table-of-contents", "empty"], ["", null]]]);
		expect(rail.lastElementChild?.getAttribute("href")).toBe("#top");
		expect(doc.querySelector("[data-test-view-cta] > .reading-frame > .view__cta-content")).not.toBeNull();
	});

	it("keeps the rail an unnamed div holding only the hidden table of contents while the reader view is pending", () => {
		const doc = render({ ...baseInput, crawl: { status: "pending" } });

		const rail = doc.querySelector("main.view > .reading-layout > [data-test-reader-rail]");
		assert(rail, "every view renders its rail, so a poll always has a target for the table of contents");
		expect([
			rail.tagName,
			rail.getAttribute("aria-label"),
			Array.from(rail.children, (child) => [child.id, child.getAttribute("data-test-table-of-contents")]),
		]).toEqual(["DIV", null, [["table-of-contents", "hidden"], ["", null]]]);
	});

	it("loads the table of contents script right after the save tip's, then the Top button's", () => {
		const doc = render();

		const bundles = Array.from(doc.querySelectorAll('script[src^="/client-dist/"]'), (script) =>
			script.getAttribute("src"),
		);
		const saveTip = bundles.indexOf("/client-dist/save-tip.client.js");
		expect(bundles.slice(saveTip, saveTip + 3)).toEqual([
			"/client-dist/save-tip.client.js",
			"/client-dist/table-of-contents.client.js",
			"/client-dist/reader-top.client.js",
		]);
	});

	it("adds the Article details rail beside the main track when the article has versions, with Article history in it and no way to remove one", () => {
		const doc = render({
			...baseInput,
			crawlVersions: ["2026-07-10T09:14Z", "2026-06-28T22:01Z"].map((iso) => ({
				minuteId: iso,
				date: toAbsoluteDate({ iso }),
				time: toAbsoluteTime({ iso }),
			})),
		});

		const layout = doc.querySelector("main.view > .reading-layout");
		assert(layout, "the reading layout must be rendered");
		expect(Array.from(layout.children, (child) => [child.tagName, child.className])).toEqual([
			["DIV", "reading-layout__main"],
			["ASIDE", "reading-layout__rail"],
		]);
		const rail = layout.querySelector(":scope > aside[data-test-reader-rail]");
		assert(rail, "the rail must sit beside the main track");
		expect(rail.getAttribute("aria-label")).toBe("Article details");
		expect(Array.from(rail.children, (child) => child.hasAttribute("data-test-article-history"))).toEqual([false, true, false]);
		expect(rail.lastElementChild?.hasAttribute("data-test-reader-top")).toBe(true);
		expect(
			Array.from(rail.querySelectorAll("[data-test-article-history-version]"), (row) =>
				row.getAttribute("data-test-article-history-version"),
			),
		).toEqual(["canonical", "2026-06-28T22:01Z"]);
		expect(doc.querySelectorAll("[data-article-body] [data-test-article-history]")).toHaveLength(0);
		const history = rail.querySelector(":scope > [data-test-article-history]");
		assert(history, "Article history must be the rail's own child");
		expect(Array.from(history.querySelectorAll("summary, form, button, [popover]"), (control) => control.tagName)).toEqual([
			"SUMMARY",
		]);
	});

	it("carries one article, the card, with the notice after it rather than inside it", () => {
		const doc = render({ ...baseInput, content: undefined });

		const articles = doc.querySelectorAll("article");
		expect(Array.from(articles, (article) => article.hasAttribute("data-test-article-card"))).toEqual([true]);
		const notice = doc.querySelector("[data-test-reader-notice]");
		assert(notice, "the notice must be rendered");
		expect([notice.closest("article"), notice.previousElementSibling]).toEqual([null, articles[0]]);
	});

	describe("share URLs and SEO", () => {
		it("renders the share dialog and the toolbar's fallback panel against the supplied appOrigin", () => {
			const doc = render({
				...baseInput,
				appOrigin: "https://staging.readplace.com",
			});

			const slot = doc.querySelector(".article-body__toolbar [data-test-share-slot]");
			assert(slot, "the toolbar must offer Share");
			const opener = slot.querySelector('[data-test-action="share-open"]');
			assert(opener, "the share slot must hold the dialog's opener");
			expect(opener.getAttribute("popovertarget")).toBe("reader-share");
			const fallback = slot.querySelector("[data-test-share-fallback]");
			assert(fallback, "the share slot must keep its disclosure for engines without popover");
			const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
			assert(dialog, "the share dialog must render");
			expect(
				[dialog, fallback].map((surface) => {
					const field = surface.querySelector("[data-test-share-url]");
					assert(field, "every share surface carries the link to copy");
					const url = new URL(field.getAttribute("value") ?? "");
					return [
						`${url.origin}${url.pathname}`,
						url.searchParams.get("utm_source"),
						url.searchParams.get("utm_medium"),
						url.searchParams.get("utm_campaign"),
					];
				}),
			).toEqual([
				["https://staging.readplace.com/view/example.com/post", "share-dialog", "copy", "reader-public"],
				["https://staging.readplace.com/view/example.com/post", "share-dialog", "copy", "reader-public"],
			]);
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
