import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { generateCspNonce } from "@packages/web-shell";
import { Base } from "../../base.component";
import { ReaderPage } from "./reader.component";
import { StickyReader } from "../../shared/article-body/reader-actions/reader-actions.component";
import type { ReaderQueueFiling } from "../queue/reader-queue-filing";

const NO_QUEUE_FILING: ReaderQueueFiling = {
	tags: undefined,
	picker: undefined,
	markStatusConfirmQueueLabels: undefined,
};

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse(
	"0123456789abcdef0123456789abcdef",
);
const url = SaveableUrlSchema.parse("https://example.com/post");

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url,
		metadata: {
			title: "Hello World",
			siteName: "example.com",
			excerpt: "A lovely article.",
			wordCount: 500,
		},
		content: "<p>Body copy.</p>",
		estimatedReadTime: MinutesSchema.parse(3),
		status: "unread",
		savedAt: new Date(),
		...overrides,
	};
}

const DEFAULT_APP_ORIGIN = "http://localhost:3000";
const TEST_BACK_LINK = {
	topHref: "/queue?back=top",
	label: "Back to queue",
};
const NOW = new Date("2026-08-05T12:00:00.000Z");
const CSP_NONCE = generateCspNonce();
const TEST_CURRENT_PATH = "/queue/abc/view";

describe("ReaderPage", () => {
	it("renders the share balloon wrap so client init can attach to it", () => {
		const html = Base(ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: StickyReader, queueFiling: NO_QUEUE_FILING, now: NOW, currentPath: TEST_CURRENT_PATH }), {
			isAuthenticated: true,
			emailVerified: undefined,
			cspNonce: CSP_NONCE,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
		assert(wrap, "share balloon wrap must be rendered");
	});

	it("points the header 'View original' at the redirect destination for a merged article", () => {
		const article = makeArticle({
			url: SaveableUrlSchema.parse("https://example.com/post.html"),
			displayUrl: "https://example.com/post",
		});
		const html = Base(
			ReaderPage(article, { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: StickyReader, queueFiling: NO_QUEUE_FILING, now: NOW, currentPath: TEST_CURRENT_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const link = doc.querySelector("[data-test-original-link]");
		assert(link, "header must render a 'View original' link");
		assert.equal(link.getAttribute("href"), "https://example.com/post");
	});

	it("points the sticky back link at the supplied backLink href and renders no bottom bar", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: StickyReader, queueFiling: NO_QUEUE_FILING, now: NOW, currentPath: TEST_CURRENT_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		assert(
			doc.querySelector(".article-body__actions--sticky [data-test-back-link]"),
			"the back link must live inside the sticky toolbar",
		);
		assert.equal(
			doc.querySelector("[data-test-back-link]")?.getAttribute("href"),
			TEST_BACK_LINK.topHref,
		);
		assert.equal(doc.querySelector(".article-body__actions--bottom"), null);
		assert.equal(doc.querySelector("[data-test-back-bottom-link]"), null);
	});

	it("renders the TL;DR collapsed by default (internal reader) — an expand is then a deliberate, measurable act", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				summary: { status: "ready", summary: "Key points." },
				crawl: { status: "ready" },
				backLink: TEST_BACK_LINK,
				renderActions: StickyReader,
				queueFiling: NO_QUEUE_FILING,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const details = doc.querySelector(".article-body__summary");
		assert(details, "ready summary <details> must render");
		expect(details.hasAttribute("open")).toBe(false);
	});

	it("stamps the summary <details> with its tracking URL and loads the summary-toggle beacon script", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				summary: { status: "ready", summary: "Key points." },
				crawl: { status: "ready" },
				backLink: TEST_BACK_LINK,
				renderActions: StickyReader,
				queueFiling: NO_QUEUE_FILING,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const details = doc.querySelector(".article-body__summary");
		assert(details, "ready summary <details> must render");
		expect(details.getAttribute("data-summary-toggle-url")).toBe(
			`/queue/${articleId.value}/summary-toggle`,
		);
		expect(html).toContain("/client-dist/summary-toggle.client.js");
	});

	it("keeps same-host in-article links in the reader tab while leaving external links alone", () => {
		const article = makeArticle({
			content:
				'<a href="https://readplace.com/queue" target="_blank">my queue</a>' +
				'<a href="https://example.com/other" target="_blank">elsewhere</a>',
		});
		const html = Base(ReaderPage(article, { appOrigin: "https://readplace.com", backLink: TEST_BACK_LINK, renderActions: StickyReader, queueFiling: NO_QUEUE_FILING, now: NOW, currentPath: TEST_CURRENT_PATH }), {
			isAuthenticated: true,
			emailVerified: undefined,
			cspNonce: CSP_NONCE,
		}).to("text/html").body;

		const content = new JSDOM(html).window.document.querySelector(
			"[data-test-reader-content]",
		);
		assert(content, "reader content must be rendered");

		const internal = content.querySelector(
			'a[href="https://readplace.com/queue"]',
		);
		const external = content.querySelector(
			'a[href="https://example.com/other"]',
		);
		assert(internal, "internal link must be present");
		assert(external, "external link must be present");
		assert.equal(internal.getAttribute("target"), "_top");
		assert.equal(external.getAttribute("target"), "_blank");
	});

	it("keeps a title carrying markup as text in the exit confirmation", () => {
		const article = makeArticle({
			metadata: {
				title: 'Why <script> & "quotes" break naive templates',
				siteName: "example.com",
				excerpt: "A lovely article.",
				wordCount: 500,
			},
		});
		const html = Base(
			ReaderPage(article, {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: StickyReader,
				queueFiling: NO_QUEUE_FILING,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				exitMarkReadConfirm: true,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const articleTitle = doc.querySelector(".confirm-popover__lead");
		assert(articleTitle, "the exit confirmation must name the article it is leaving");
		assert.equal(articleTitle.textContent, 'Why <script> & "quotes" break naive templates');
		assert.equal(articleTitle.querySelector("script"), null);
	});

	it("asks nothing on exit once the article is read, but still loads the script the next swap needs", () => {
		const html = Base(
			ReaderPage(makeArticle({ status: "read" }), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: StickyReader,
				queueFiling: NO_QUEUE_FILING,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				exitMarkReadConfirm: true,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		assert.equal(doc.querySelectorAll("[data-test-confirm-popover='exit-confirm']").length, 0);
		expect(html).toContain("/client-dist/reader-exit-confirm.client.js");
	});

	it("renders the share-balloon URLs against the supplied appOrigin, not a hardcoded host", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: "https://staging.readplace.com", backLink: TEST_BACK_LINK, renderActions: StickyReader, queueFiling: NO_QUEUE_FILING, now: NOW, currentPath: TEST_CURRENT_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const shareBtn = doc.querySelector("[data-test-share-balloon]");
		assert(shareBtn, "share button must be rendered");
		const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
		assert.equal(shareUrl.origin, "https://staging.readplace.com");

		const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
		assert(copyBtn, "copy button must be rendered");
		const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
		assert.equal(copyUrl.origin, "https://staging.readplace.com");
	});
});
