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
			"imageUrl",
			"estimatedReadTimeMinutes",
			"status",
			"savedAt",
			"readAt",
			"isRead",
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
		expect(entity.links).toContainEqual({ rel: ["account"], title: "Account", href: "/account" });
	});

	it("tags the account link with ?platform=ios for the iOS app surface so its WKWebView renders no in-app purchase paths (Guideline 3.1.1)", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { iosSurface: true });

		expect(entity.links).toContainEqual({
			rel: ["account"],
			title: "Account",
			href: "/account?platform=ios",
		});
	});

	it("advertises a titled add-links-help link so already-installed clients resolve the help URL", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.links).toContainEqual({
			rel: ["add-links-help"],
			title: "How to add links",
			href: "/help/add-links",
		});
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

	it("last page omits the next link", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 22,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2, pageSize: 20 });

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root", "account", "add-links-help", "prev"]);
	});

	it("single page omits both pagination links", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root", "account", "add-links-help"]);
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
		expect(saveAction?.title).toBe("Save a link");
	});

	it("gives every advertised action a human title", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const titles = Object.fromEntries(
			(entity.actions ?? []).map((a) => [a.name, a.title]),
		);
		expect(titles).toEqual({
			"save-article": "Save a link",
			"save-html": "Save a page",
			"save-content": "Save a file",
			search: "Search",
		});
	});

	it("includes save-articles bulk action", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const saveArticlesAction = entity.actions?.find((a) => a.name === "save-articles");
		expect(saveArticlesAction?.href).toBe("/queue/save-articles");
		expect(saveArticlesAction?.method).toBe("POST");
		expect(saveArticlesAction?.type).toBe("multipart/form-data");
		expect(saveArticlesAction?.fields?.map((f) => f.name)).toEqual(["manifest", "content"]);
	});

	it("advertises a create-session action so a client discovers the reader session mint", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		const sessionAction = entity.actions?.find((a) => a.name === "create-session");
		expect(sessionAction?.href).toBe("/auth/session");
		expect(sessionAction?.method).toBe("POST");
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
			"url",
		]);
	});

	it("attaches a warning to properties when one is provided", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(
			result,
			{},
			{ warning: { code: "unsupported_scheme", message: "Only http and https URLs can be saved" } },
		);

		expect(entity.properties).toMatchObject({
			warning: {
				code: "unsupported_scheme",
				message: "Only http and https URLs can be saved",
			},
		});
	});

	it("points every embedded article's read link at the /view reader", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 2,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		for (const sub of entity.entities ?? []) {
			const readLink = sub.links?.find((l) => l.rel.includes("read"));
			expect(readLink?.href).toMatch(/\/queue\/.+\/view$/);
		}
	});

	it("omits warning from properties when no option is provided", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.properties).not.toHaveProperty("warning");
	});

	it("attaches the iOS save-in-progress notice to properties for a native-app request", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { iosClient: true });

		expect(entity.properties).toMatchObject({
			messages: [
				{
					type: "warning",
					content: { type: "text/html", body: "Don't close this — it's still saving." },
				},
			],
		});
	});

	it("omits the save-in-progress notice when the request is not the native iOS app", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {});

		expect(entity.properties).not.toHaveProperty("messages");
	});

});
