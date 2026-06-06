import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { Base } from "../../base.component";
import { ReaderPage } from "./reader.component";

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
const HIGHLIGHTS_OPTS = {
	highlights: [],
	highlightsCreateUrl: "/queue/0123456789abcdef0123456789abcdef/highlights",
} as const;

describe("ReaderPage", () => {
	it("renders the share balloon wrap so client init can attach to it", () => {
		const html = Base(ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, ...HIGHLIGHTS_OPTS }), {
			isAuthenticated: true,
			emailVerified: undefined,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
		assert(wrap, "share balloon wrap must be rendered");
	});

	it("renders the highlights side panel with an empty state and the create URL the client posts to", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, ...HIGHLIGHTS_OPTS }),
			{ isAuthenticated: true, emailVerified: undefined },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const panel = doc.querySelector("[data-highlights]");
		assert(panel, "highlights panel must be rendered");
		assert.equal(
			panel.getAttribute("data-highlights-create-url"),
			"/queue/0123456789abcdef0123456789abcdef/highlights",
		);
		assert(
			doc.querySelector("[data-test-highlights-empty]"),
			"empty state must show when there are no highlights",
		);
	});

	it("renders saved highlights with their notes and a delete affordance", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				highlightsCreateUrl: "/queue/0123456789abcdef0123456789abcdef/highlights",
				highlights: [
					{
						id: "h1",
						quote: "a memorable line",
						note: "why it matters",
						deleteUrl: "/queue/0123456789abcdef0123456789abcdef/highlights/h1/delete",
					},
				],
			}),
			{ isAuthenticated: true, emailVerified: undefined },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const item = doc.querySelector("[data-test-highlight]");
		assert(item, "highlight item must be rendered");
		assert.equal(item.getAttribute("data-highlight-quote"), "a memorable line");
		assert.equal(doc.querySelector("[data-test-highlight-note]")?.textContent, "why it matters");
		assert.equal(
			doc.querySelector("[data-test-highlight-delete]")?.getAttribute("action"),
			"/queue/0123456789abcdef0123456789abcdef/highlights/h1/delete",
		);
	});

	it("stamps utm_content on the share balloon URLs with the first 6 chars of the article owner's user id", () => {
		const article = makeArticle({
			userId: UserIdSchema.parse("abcdef0123456789abcdef0123456789"),
		});
		const html = Base(ReaderPage(article, { appOrigin: DEFAULT_APP_ORIGIN, ...HIGHLIGHTS_OPTS }), {
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
		const html = Base(ReaderPage(article, { appOrigin: "https://readplace.com" }), {
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
			ReaderPage(makeArticle(), { appOrigin: "https://staging.readplace.com", ...HIGHLIGHTS_OPTS }),
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
});
