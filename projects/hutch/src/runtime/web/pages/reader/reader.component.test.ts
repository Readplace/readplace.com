import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
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

function render(
	article: SavedArticle,
	options?: { crawl?: ArticleCrawl },
): Document {
	const html = Base(ReaderPage(article, { crawl: options?.crawl }), {
		isAuthenticated: true,
		emailVerified: undefined,
	}).to("text/html").body;
	return new JSDOM(html).window.document;
}

function autoOpenAttr(doc: Document): string | null {
	const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
	assert(wrap, "share balloon wrap must be rendered");
	return wrap.getAttribute("data-share-balloon-auto-open");
}

describe("ReaderPage — share balloon auto-open gating", () => {
	it("enables auto-open when content is present and crawl is ready", () => {
		const doc = render(makeArticle(), { crawl: { status: "ready" } });
		expect(autoOpenAttr(doc)).toBe("true");
	});

	it("disables auto-open while the crawl is still pending (article loading)", () => {
		const article = makeArticle({ content: undefined });
		const doc = render(article, { crawl: { status: "pending" } });
		expect(autoOpenAttr(doc)).toBe("false");
	});

	it("disables auto-open when the crawl has failed (article errored)", () => {
		const article = makeArticle({ content: undefined });
		const doc = render(article, {
			crawl: { status: "failed", reason: "blocked" },
		});
		expect(autoOpenAttr(doc)).toBe("false");
	});

	it("disables auto-open when the crawl is unsupported (article errored)", () => {
		const article = makeArticle({ content: undefined });
		const doc = render(article, {
			crawl: { status: "unsupported", reason: "non-html content type" },
		});
		expect(autoOpenAttr(doc)).toBe("false");
	});

	it("disables auto-open when content is missing on a legacy row (read-after-write race)", () => {
		const article = makeArticle({ content: undefined });
		const doc = render(article);
		expect(autoOpenAttr(doc)).toBe("false");
	});
});
