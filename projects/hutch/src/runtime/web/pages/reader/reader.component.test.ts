import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type { Highlight } from "@packages/domain/highlight";
import { Base } from "../../base.component";
import { ReaderPage } from "./reader.component";

function renderReaderDoc(article: SavedArticle, options: Parameters<typeof ReaderPage>[1]) {
	const html = Base(ReaderPage(article, options), {
		isAuthenticated: true,
		emailVerified: undefined,
	}).to("text/html").body;
	return new JSDOM(html).window.document;
}

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

describe("ReaderPage", () => {
	it("renders the share balloon wrap so client init can attach to it", () => {
		const html = Base(ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, highlights: [] }), {
			isAuthenticated: true,
			emailVerified: undefined,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
		assert(wrap, "share balloon wrap must be rendered");
	});

	it("stamps utm_content on the share balloon URLs with the first 6 chars of the article owner's user id", () => {
		const article = makeArticle({
			userId: UserIdSchema.parse("abcdef0123456789abcdef0123456789"),
		});
		const html = Base(ReaderPage(article, { appOrigin: DEFAULT_APP_ORIGIN, highlights: [] }), {
			isAuthenticated: true,
			emailVerified: undefined,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const shareBtn = doc.querySelector("[data-test-share-balloon]");
		assert(shareBtn, "share button must be rendered");
		const shareHref = shareBtn.getAttribute("data-share-url");
		assert(shareHref, "share button must carry a data-share-url");
		const shareUrl = new URL(shareHref);
		assert.equal(shareUrl.searchParams.get("utm_content"), "abcdef");

		const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
		assert(copyBtn, "copy button must be rendered");
		const copyHref = copyBtn.getAttribute("data-share-url");
		assert(copyHref, "copy button must carry a data-share-url");
		const copyUrl = new URL(copyHref);
		assert.equal(copyUrl.searchParams.get("utm_content"), "abcdef");
	});

	it("keeps same-host in-article links in the reader tab while leaving external links alone", () => {
		const article = makeArticle({
			content:
				'<a href="https://readplace.com/queue" target="_blank">my queue</a>' +
				'<a href="https://example.com/other" target="_blank">elsewhere</a>',
		});
		const html = Base(ReaderPage(article, { appOrigin: "https://readplace.com", highlights: [] }), {
			isAuthenticated: true,
			emailVerified: undefined,
		}).to("text/html").body;

		const iframe = new JSDOM(html).window.document.querySelector(
			"iframe[data-reader-iframe]",
		);
		assert(iframe, "reader iframe must be rendered");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "reader iframe must carry a srcdoc");
		const iframeDoc = new JSDOM(srcdoc).window.document;

		const internal = iframeDoc.querySelector(
			'a[href="https://readplace.com/queue"]',
		);
		const external = iframeDoc.querySelector(
			'a[href="https://example.com/other"]',
		);
		assert(internal, "internal link must be present");
		assert(external, "external link must be present");
		assert.equal(internal.getAttribute("target"), "_top");
		assert.equal(external.getAttribute("target"), "_blank");
	});

	it("renders the share-balloon URLs against the supplied appOrigin, not a hardcoded host", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: "https://staging.readplace.com", highlights: [] }),
			{ isAuthenticated: true, emailVerified: undefined },
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

	it("renders the highlights panel wired to the article's create route", () => {
		const doc = renderReaderDoc(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, highlights: [] });
		const panel = doc.querySelector("[data-highlights-panel]");
		assert(panel, "highlights panel must render");
		assert.equal(
			panel.getAttribute("data-highlights-create-url"),
			`/queue/${articleId.value}/highlights`,
		);
	});

	it("loads the highlights client script", () => {
		const doc = renderReaderDoc(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, highlights: [] });
		assert(
			doc.querySelector('script[src="/client-dist/highlights.client.js"]'),
			"highlights client script must be included",
		);
	});

	it("renders one side-menu entry per supplied highlight", () => {
		const highlights: Highlight[] = [
			{
				id: HighlightIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
				userId,
				articleId: articleId.value,
				anchor: { start: 0, end: 5, quote: "Hello" },
				createdAt: "2026-06-05T00:00:01.000Z",
			},
		];
		const doc = renderReaderDoc(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, highlights });
		assert.equal(doc.querySelectorAll("[data-highlights-item]").length, 1);
		assert.equal(doc.querySelector("[data-test-highlights-empty]"), null);
	});
});
