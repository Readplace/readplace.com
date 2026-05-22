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

describe("ReaderPage", () => {
	it("renders the share balloon wrap so client init can attach to it", () => {
		const html = Base(ReaderPage(makeArticle()), {
			isAuthenticated: true,
			emailVerified: undefined,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
		assert(wrap, "share balloon wrap must be rendered");
	});
});
