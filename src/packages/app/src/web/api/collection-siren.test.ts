import type {
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { FindArticlesResult } from "@packages/test-fixtures/providers/article-store";
import { toArticleCollectionEntity } from "./collection-siren";

function makeArticle(idHint: string): SavedArticle {
	const url = `https://example.com/${idHint}`;
	return {
		id: ReaderArticleHashId.from(url),
		userId: "test-user-id" as UserId,
		url,
		metadata: {
			title: `Article ${idHint}`,
			siteName: "Example",
			excerpt: "First paragraph...",
			wordCount: 1200,
		},
		content: "<p>Full content</p>",
		estimatedReadTime: 5 as Minutes,
		status: "unread",
		savedAt: new Date("2026-03-04T10:00:00.000Z"),
	};
}

describe("toArticleCollectionEntity", () => {
	it("includes collection and articles classes", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.class).toContain("collection");
		expect(entity.class).toContain("articles");
	});

	it("includes pagination properties", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 42,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2, pageSize: 20 });

		expect(entity.properties).toMatchObject({
			total: 42,
			page: 2,
			pageSize: 20,
		});
	});

	it("embeds articles as sub-entities with rel: item", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 2,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.entities).toHaveLength(2);
		expect(entity.entities?.[0].rel).toContain("item");
		expect(entity.entities?.[1].rel).toContain("item");
	});

	it("embedded articles have exact property keys without content", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(Object.keys(entity.entities?.[0].properties ?? {})).toEqual([
			"id",
			"url",
			"title",
			"siteName",
			"excerpt",
			"wordCount",
			"imageUrl",
			"estimatedReadTimeMinutes",
			"status",
			"savedAt",
			"readAt",
		]);
	});

	it("includes self and root links", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.links).toContainEqual({ rel: ["self"], href: "/queue" });
		expect(entity.links).toContainEqual({ rel: ["root"], href: "/queue" });
	});

	it("includes next link when more pages exist", () => {
		const result: FindArticlesResult = {
			articles: Array.from({ length: 20 }, (_, i) => makeArticle(`${i}`)),
			total: 42,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { pageSize: 20 });

		const nextLink = entity.links?.find((l) => l.rel.includes("next"));
		expect(nextLink?.href).toContain("page=2");
	});

	it("includes prev link when not on first page", () => {
		const result: FindArticlesResult = {
			articles: Array.from({ length: 20 }, (_, i) => makeArticle(`${i}`)),
			total: 42,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2, pageSize: 20 });

		const prevLink = entity.links?.find((l) => l.rel.includes("prev"));
		expect(prevLink?.href).toContain("page=1");
	});

	it("last page has only self and root links", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 22,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2, pageSize: 20 });

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root", "prev"]);
	});

	it("first page has only self and root links", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root"]);
	});

	it("preserves query params in pagination links", () => {
		const result: FindArticlesResult = {
			articles: Array.from({ length: 20 }, (_, i) => makeArticle(`${i}`)),
			total: 42,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {
			status: "unread",
			order: "desc",
			pageSize: 20,
		});

		const nextLink = entity.links?.find((l) => l.rel.includes("next"));
		expect(nextLink?.href).toContain("status=unread");
		expect(nextLink?.href).toContain("order=desc");
	});

	it("includes save-article action", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const saveAction = entity.actions?.find((a) => a.name === "save-article");
		expect(saveAction?.method).toBe("POST");
		expect(saveAction?.fields?.some((f) => f.name === "url")).toBe(true);
	});

	it("includes search action with filter fields", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const filterAction = entity.actions?.find(
			(a) => a.name === "search",
		);
		expect(filterAction?.method).toBe("GET");
		expect(filterAction?.fields?.map((f) => f.name)).toEqual([
			"status",
			"order",
			"page",
			"pageSize",
			"url",
		]);
	});

});
