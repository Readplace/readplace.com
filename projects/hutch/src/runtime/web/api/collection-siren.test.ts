import type {
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId, MAX_UPLOAD_REQUEST_BYTES } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { FindArticlesResult } from "@packages/test-fixtures/providers/article-store";
import { toArticleCollectionEntity } from "./collection-siren";

const tabs = [
	{ label: "To Read", status: "unread" },
	{ label: "Read", status: "read" },
] as const;

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
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.class).toContain("collection");
		expect(entity.class).toContain("articles");
	});

	it("includes pagination properties", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 42,
			hasMore: true,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2 }, { tabs });

		expect(entity.properties).toMatchObject({
			pageSize: 20,
		});
	});

	it("advertises every page, carrying the filters and no page size in each href", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 42,
			hasMore: true,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {
			status: "unread",
			order: "desc",
			page: 2,
		}, { tabs });

		expect(entity.properties?.pages).toEqual([
			{ label: "1", rel: "prev", href: "/queue?status=unread&order=desc&page=1" },
			{ label: "2", rel: "current", href: "/queue?status=unread&order=desc&page=2" },
			{ label: "3", rel: "next", href: "/queue?status=unread&order=desc&page=3" },
		]);
	});

	it("advertises the status tabs with the served one current, each href carrying only the status", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 42,
			hasMore: true,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(
			result,
			{ status: "unread", page: 2, url: "https://example.com/1" },
			{ tabs },
		);

		expect(entity.properties?.tabs).toEqual([
			{ label: "To Read", rel: "current", href: "/queue?status=unread" },
			{ label: "Read", rel: "tab", href: "/queue?status=read" },
		]);
	});

	it("marks the read tab current and carries the requested order into every tab href", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { status: "read", order: "asc" }, { tabs });

		expect(entity.properties?.tabs).toEqual([
			{ label: "To Read", rel: "tab", href: "/queue?status=unread&order=asc" },
			{ label: "Read", rel: "current", href: "/queue?status=read&order=asc" },
		]);
	});

	it("marks no tab current on a collection that is not filtered by status", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.properties?.tabs).toEqual([
			{ label: "To Read", rel: "tab", href: "/queue?status=unread" },
			{ label: "Read", rel: "tab", href: "/queue?status=read" },
		]);
	});

	it("bakes the collection's status into each embedded update-status href so the redirect lands back on the same tab", () => {
		const read: SavedArticle = { ...makeArticle("1"), status: "read", readAt: new Date("2026-03-04T12:00:00.000Z") };
		const unread = makeArticle("2");
		const readList: FindArticlesResult = { articles: [read], total: 1, hasMore: false, page: 1, pageSize: 20 };
		const unreadList: FindArticlesResult = { articles: [unread], total: 1, hasMore: false, page: 1, pageSize: 20 };

		const onReadTab = toArticleCollectionEntity(readList, { status: "read", order: "asc" }, { tabs });
		const onUnreadTab = toArticleCollectionEntity(unreadList, { status: "unread" }, { tabs });

		const updateStatusHref = (entity: ReturnType<typeof toArticleCollectionEntity>) =>
			entity.entities?.[0].actions?.find((a) => a.name === "update-status")?.href;
		expect([updateStatusHref(onReadTab), updateStatusHref(onUnreadTab)]).toEqual([
			`/queue/${read.id.value}/status?status=read&order=asc`,
			`/queue/${unread.id.value}/status?status=unread`,
		]);
	});

	it("advertises a lone current page when everything fits on one", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.properties?.pages).toEqual([
			{ label: "1", rel: "current", href: "/queue?page=1" },
		]);
	});

	it("embeds articles as sub-entities with rel: item", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 2,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.entities).toHaveLength(2);
		expect(entity.entities?.[0].rel).toContain("item");
		expect(entity.entities?.[1].rel).toContain("item");
	});

	it("embedded articles have exact property keys without content", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(Object.keys(entity.entities?.[0].properties ?? {})).toEqual([
			"id",
			"url",
			"title",
			"siteName",
			"excerpt",
			"imageUrl",
			"estimatedReadTimeMinutes",
			"readTime",
			"status",
			"savedAt",
			"readAt",
			"isRead",
			"needsBrowserCapture",
		]);
	});

	it("resolves each row's crawl state by that row's own url, so only the edge-blocked article asks for a browser capture", () => {
		const blocked = makeArticle("blocked");
		const ready = makeArticle("ready");
		const result: FindArticlesResult = {
			articles: [blocked, ready],
			total: 2,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(
			result,
			{},
			{
				tabs,
				crawlByUrl: new Map<string, ArticleCrawl | undefined>([
					[
						blocked.url,
						{ status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
					],
					[ready.url, { status: "ready" }],
				]),
			},
		);

		expect(
			(entity.entities ?? []).map((sub) => [
				sub.properties?.url,
				sub.properties?.needsBrowserCapture,
			]),
		).toEqual([
			[blocked.url, true],
			[ready.url, false],
		]);
	});

	it("reports no browser capture on any row when the crawl states were never loaded — an absent read must not fabricate an affordance", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 2,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(
			(entity.entities ?? []).map((sub) => sub.properties?.needsBrowserCapture),
		).toEqual([false, false]);
	});

	it("includes self and root links", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.links).toContainEqual({ rel: ["self"], href: "/queue" });
		expect(entity.links).toContainEqual({ rel: ["root"], href: "/queue" });
		expect(entity.links).toContainEqual({ rel: ["account"], title: "Account", href: "/account" });
	});

	it("tags the account link with ?platform=ios for the iOS app surface so its WKWebView renders no in-app purchase paths (Guideline 3.1.1)", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs, surfacePlatform: "ios" });

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
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

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
			hasMore: true,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const nextLink = entity.links?.find((l) => l.rel.includes("next"));
		expect(nextLink?.href).toContain("page=2");
	});

	it("includes prev link when not on first page", () => {
		const result: FindArticlesResult = {
			articles: Array.from({ length: 20 }, (_, i) => makeArticle(`${i}`)),
			total: 42,
			hasMore: true,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2 }, { tabs });

		const prevLink = entity.links?.find((l) => l.rel.includes("prev"));
		expect(prevLink?.href).toContain("page=1");
	});

	it("last page omits the next link", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1"), makeArticle("2")],
			total: 22,
			hasMore: false,
			page: 2,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, { page: 2 }, { tabs });

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root", "account", "add-links-help", "prev"]);
	});

	it("single page omits both pagination links", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			total: 1,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const linkRels = entity.links?.map((l) => l.rel[0]);
		expect(linkRels).toEqual(["self", "root", "account", "add-links-help"]);
	});

	it("preserves query params in pagination links", () => {
		const result: FindArticlesResult = {
			articles: Array.from({ length: 20 }, (_, i) => makeArticle(`${i}`)),
			total: 42,
			hasMore: true,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {
			status: "unread",
			order: "desc",
		}, { tabs });

		const nextLink = entity.links?.find((l) => l.rel.includes("next"));
		expect(nextLink?.href).toContain("status=unread");
		expect(nextLink?.href).toContain("order=desc");
	});

	it("includes save-article action", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const saveAction = entity.actions?.find((a) => a.name === "save-article");
		expect(saveAction?.method).toBe("POST");
		expect(saveAction?.fields?.some((f) => f.name === "url")).toBe(true);
		expect(saveAction?.title).toBe("Save a link");
	});

	it("gives every advertised action a human title", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const titles = Object.fromEntries(
			(entity.actions ?? []).map((a) => [a.name, a.title]),
		);
		expect(titles).toEqual({
			"save-article": "Save a link",
			"save-content": "Save a file",
			search: "Search",
		});
	});

	it("includes save-articles bulk action", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const saveArticlesAction = entity.actions?.find((a) => a.name === "save-articles");
		expect(saveArticlesAction?.href).toBe("/queue/save-articles");
		expect(saveArticlesAction?.method).toBe("POST");
		expect(saveArticlesAction?.type).toBe("multipart/form-data");
		expect(saveArticlesAction?.fields?.map((f) => f.name)).toEqual(["manifest", "content"]);
		const contentField = saveArticlesAction?.fields?.find((f) => f.name === "content");
		expect(contentField?.maxRequestBytes).toBe(MAX_UPLOAD_REQUEST_BYTES);
	});

	it("advertises a create-session action so a client discovers the reader session mint", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		const sessionAction = entity.actions?.find((a) => a.name === "create-session");
		expect(sessionAction?.href).toBe("/auth/session");
		expect(sessionAction?.method).toBe("POST");
	});

	it("includes search action with filter fields", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

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
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(
			result,
			{},
			{ tabs, warning: { code: "unsupported_scheme", message: "Only http and https URLs can be saved" } },
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
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		for (const sub of entity.entities ?? []) {
			const readLink = sub.links?.find((l) => l.rel.includes("read"));
			expect(readLink?.href).toMatch(/\/queue\/.+\/view$/);
		}
	});

	it("omits warning from properties when no option is provided", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.properties).not.toHaveProperty("warning");
	});

	it("attaches the iOS save-in-progress notice to properties for a native-app request", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 0,
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs, showSaveInProgressNotice: true });

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
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		const entity = toArticleCollectionEntity(result, {}, { tabs });

		expect(entity.properties).not.toHaveProperty("messages");
	});

	it("throws when the result carries no total, since Siren pagination cannot be derived without one", () => {
		const result: FindArticlesResult = {
			articles: [makeArticle("1")],
			hasMore: false,
			page: 1,
			pageSize: 20,
		};

		expect(() => toArticleCollectionEntity(result, {}, { tabs })).toThrow(
			"Siren collection requires a total",
		);
	});

});
