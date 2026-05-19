import type {
	ArticleStatus,
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { toArticleSubEntity, toArticleEntity } from "./article-siren";

const ARTICLE_URL = "https://example.com/article";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL).value;

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "test-user-id" as UserId,
		url: ARTICLE_URL,
		metadata: {
			title: "Test Article",
			siteName: "Example",
			excerpt: "First paragraph...",
			wordCount: 1200,
			imageUrl: "https://example.com/image.jpg",
		},
		content: "<p>Full article content</p>",
		estimatedReadTime: 5 as Minutes,
		status: "unread" as ArticleStatus,
		savedAt: new Date("2026-03-04T10:00:00.000Z"),
		readAt: undefined,
		...overrides,
	};
}

describe("toArticleSubEntity", () => {
	it("maps sub-entity with exact properties (no content) and structure", () => {
		const article = makeArticle({ content: "<p>Full text</p>" });
		const subEntity = toArticleSubEntity(article);

		expect(subEntity).toEqual({
			class: ["article"],
			rel: ["item"],
			properties: {
				id: ARTICLE_ID,
				url: ARTICLE_URL,
				title: "Test Article",
				siteName: "Example",
				excerpt: "First paragraph...",
				wordCount: 1200,
				imageUrl: "https://example.com/image.jpg",
				estimatedReadTimeMinutes: 5,
				status: "unread",
				savedAt: "2026-03-04T10:00:00.000Z",
				readAt: null,
			},
			links: [
				{ rel: ["read"], href: `/queue/${ARTICLE_ID}/view` },
			],
			actions: [{ name: "delete", href: `/queue/${ARTICLE_ID}/delete`, method: "POST" }],
		});
	});

	it("includes read link when article has no content", () => {
		const article = makeArticle({ content: undefined });
		const subEntity = toArticleSubEntity(article);

		expect(subEntity.links).toEqual([
			{ rel: ["read"], href: `/queue/${ARTICLE_ID}/view` },
		]);
	});

	it("maps readAt when present", () => {
		const article = makeArticle({
			status: "read",
			readAt: new Date("2026-03-04T12:00:00.000Z"),
		});
		const subEntity = toArticleSubEntity(article);

		expect(subEntity.properties?.readAt).toBe("2026-03-04T12:00:00.000Z");
	});
});

describe("toArticleEntity", () => {
	it("returns same structure as sub-entity without rel", () => {
		const article = makeArticle();
		const entity = toArticleEntity(article);
		const subEntity = toArticleSubEntity(article);

		expect(entity).not.toHaveProperty("rel");
		expect(entity.class).toEqual(subEntity.class);
		expect(entity.properties).toEqual(subEntity.properties);
		expect(entity.links).toEqual(subEntity.links);
		expect(entity.actions).toEqual(subEntity.actions);
	});
});
