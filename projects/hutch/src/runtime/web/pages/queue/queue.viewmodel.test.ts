import type {
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { FindArticlesResult } from "@packages/test-fixtures/providers/article-store";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { toQueueViewModel } from "./queue.viewmodel";

const ARTICLE_URL = "https://example.com/post";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL).value;

function makeArticle(overrides?: Partial<SavedArticle>): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "user-1" as UserId,
		url: ARTICLE_URL,
		metadata: {
			title: "Test Article",
			siteName: "example.com",
			excerpt: "An excerpt",
			wordCount: 500,
		},
		estimatedReadTime: 3 as Minutes,
		status: "unread",
		savedAt: new Date("2025-06-01T12:00:00Z"),
		...overrides,
	};
}

function makeResult(
	articles: SavedArticle[],
	total?: number,
): FindArticlesResult {
	return {
		articles,
		total: total ?? articles.length,
		page: 1,
		pageSize: 20,
	};
}

const NOW = new Date("2025-06-01T13:00:00Z");
const DEFAULT_FILTERS = { tab: "queue" as const, order: "desc" as const, page: 1 };

describe("toQueueViewModel", () => {
	it("should map article fields to view model", () => {
		const vm = toQueueViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].title).toBe("Test Article");
		expect(vm.articles[0].siteName).toBe("example.com");
		expect(vm.articles[0].url).toBe("https://example.com/post");
	});

	it("should format read time label", () => {
		const vm = toQueueViewModel(
			makeResult([makeArticle({ estimatedReadTime: 5 as Minutes })]),
			DEFAULT_FILTERS,
			{ now: NOW },
		);

		expect(vm.articles[0].readTimeLabel).toBe("5 min read");
	});

	it("should format relative date as hours ago", () => {
		const vm = toQueueViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].savedAgo).toBe("1h ago");
	});

	it("should format recent date as minutes ago", () => {
		const article = makeArticle({
			savedAt: new Date("2025-06-01T12:50:00Z"),
		});
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].savedAgo).toBe("10m ago");
	});

	it("should calculate totalPages", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 45,
			page: 1,
			pageSize: 20,
		};
		const vm = toQueueViewModel(result, DEFAULT_FILTERS, { now: NOW });

		expect(vm.totalPages).toBe(3);
	});

	it("should set isEmpty when no articles", () => {
		const vm = toQueueViewModel(makeResult([]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.isEmpty).toBe(true);
	});

	it("should include filter URLs", () => {
		const vm = toQueueViewModel(makeResult([]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.filterUrls.unread).toBe("/queue");
		expect(vm.filterUrls.read).toBe("/queue?tab=done");
	});

	it("should set isUnread to true for unread articles", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].isUnread).toBe(true);
	});

	it("should set isUnread to false for read articles", () => {
		const article = makeArticle({ status: "read" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].isUnread).toBe(false);
	});

	it("should pass imageUrl from article metadata to view model", () => {
		const article = makeArticle({
			metadata: {
				title: "Test Article",
				siteName: "example.com",
				excerpt: "An excerpt",
				wordCount: 500,
				imageUrl: "https://example.com/thumbnail.jpg",
			},
		});
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].imageUrl).toBe(
			"https://example.com/thumbnail.jpg",
		);
	});

	it("should leave imageUrl undefined when article has no image", () => {
		const vm = toQueueViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].imageUrl).toBeUndefined();
	});

	it("should format relative date as days ago", () => {
		const article = makeArticle({
			savedAt: new Date("2025-05-29T12:00:00Z"),
		});
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].savedAgo).toBe("3d ago");
	});

	it("should format date older than 30 days as full date", () => {
		const article = makeArticle({
			savedAt: new Date("2025-04-01T12:00:00Z"),
		});
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].savedAgo).toBe("1 Apr 2025");
	});

	it("should format very recent date as just now", () => {
		const article = makeArticle({
			savedAt: new Date("2025-06-01T12:59:50Z"),
		});
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].savedAgo).toBe("just now");
	});

	it("should generate next pagination URL when more pages exist", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 45,
			page: 1,
			pageSize: 20,
		};
		const vm = toQueueViewModel(result, DEFAULT_FILTERS, { now: NOW });

		expect(vm.paginationUrls.next).toBe("/queue?page=2");
	});

	it("should generate prev pagination URL on page 2", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 45,
			page: 2,
			pageSize: 20,
		};
		const vm = toQueueViewModel(result, { ...DEFAULT_FILTERS, page: 2 }, { now: NOW });

		expect(vm.paginationUrls.prev).toBe("/queue");
	});

	it("should not generate next pagination URL on last page", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 45,
			page: 3,
			pageSize: 20,
		};
		const vm = toQueueViewModel(result, { ...DEFAULT_FILTERS, page: 3 }, { now: NOW });

		expect(vm.paginationUrls.next).toBeUndefined();
	});

	it("should pass saveError through to view model", () => {
		const vm = toQueueViewModel(makeResult([]), DEFAULT_FILTERS, {
			now: NOW,
			saveError: "Could not parse article: Invalid URL",
		});

		expect(vm.saveError).toBe("Could not parse article: Invalid URL");
	});

	it("should set hasContent to true when article has content", () => {
		const article = makeArticle({ content: "<p>Some content</p>" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].hasContent).toBe(true);
	});

	it("should set hasContent to false when article has no content", () => {
		const article = makeArticle({ content: undefined });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].hasContent).toBe(false);
	});

	it("should generate mark-read and delete actions for unread article", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const actions = vm.articles[0].actions;
		expect(actions.map(a => a.testAction)).toEqual(["mark-read", "delete"]);
	});

	it("should generate mark-unread and delete actions for read article", () => {
		const article = makeArticle({ status: "read" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const actions = vm.articles[0].actions;
		expect(actions.map(a => a.testAction)).toEqual(["mark-unread", "delete"]);
	});

	it("should include return query in action URLs for non-default view", () => {
		const article = makeArticle({ status: "read" });
		const filters = { order: "asc" as const, page: 1, tab: "done" as const };
		const vm = toQueueViewModel(makeResult([article]), filters, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.url).toBe(`/queue/${ARTICLE_ID}/delete?tab=done&order=asc`);
	});

	it("should not include query string in action URLs for default view", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.url).toBe(`/queue/${ARTICLE_ID}/delete`);
	});

	it("should use POST method and /status URL for mark-unread action", () => {
		const article = makeArticle({ status: "read" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const markUnreadAction = vm.articles[0].actions.find(a => a.testAction === "mark-unread");
		expect(markUnreadAction?.method).toBe("POST");
		expect(markUnreadAction?.url).toBe(`/queue/${ARTICLE_ID}/status`);
		expect(markUnreadAction?.fields).toEqual([{ name: "status", value: "unread" }]);
	});

	it("should use POST method and /status URL for mark-read action", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const markReadAction = vm.articles[0].actions.find(a => a.testAction === "mark-read");
		expect(markReadAction?.method).toBe("POST");
		expect(markReadAction?.url).toBe(`/queue/${ARTICLE_ID}/status`);
		expect(markReadAction?.fields).toEqual([{ name: "status", value: "read" }]);
	});

	it("should include return query in mark-read URL for non-default view", () => {
		const article = makeArticle({ status: "unread" });
		const filters = { order: "asc" as const, page: 1, tab: "queue" as const };
		const vm = toQueueViewModel(makeResult([article]), filters, { now: NOW });

		const markReadAction = vm.articles[0].actions.find(a => a.testAction === "mark-read");
		expect(markReadAction?.url).toBe(`/queue/${ARTICLE_ID}/status?order=asc`);
	});

	it("should have no hidden fields in delete action", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.fields).toEqual([]);
	});

	it("should use POST for all actions", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const methods = vm.articles[0].actions.map(a => a.method);
		expect(methods).toEqual(["POST", "POST"]);
	});

	it("should include unreadCount from options", () => {
		const vm = toQueueViewModel(makeResult([]), DEFAULT_FILTERS, {
			now: NOW,
			unreadCount: 42,
		});

		expect(vm.unreadCount).toBe(42);
	});

	it("should leave unreadCount undefined when not provided so the template renders a loading placeholder", () => {
		// The two partition-wide COUNT queries that used to feed unreadCount /
		// totalArticles synchronously have been moved to GET /queue/counts so
		// they don't sit on the page's critical render path. The synchronous
		// viewmodel must therefore expose "unknown" instead of silently falling
		// back to result.total — the template uses this to render a "…"
		// placeholder until htmx swaps in the real number.
		const vm = toQueueViewModel(makeResult([], 7), DEFAULT_FILTERS, { now: NOW });

		expect(vm.unreadCount).toBeUndefined();
	});

	it("should include totalArticles from options independent of current filter", () => {
		const vm = toQueueViewModel(makeResult([], 0), DEFAULT_FILTERS, {
			now: NOW,
			totalArticles: 8,
		});

		expect(vm.totalArticles).toBe(8);
		expect(vm.total).toBe(0);
	});

	it("should leave totalArticles undefined when not provided so the template renders a loading placeholder", () => {
		const vm = toQueueViewModel(makeResult([], 5), DEFAULT_FILTERS, { now: NOW });

		expect(vm.totalArticles).toBeUndefined();
	});

	it("should prefer the AI-generated excerpt over the summary when status is ready", () => {
		const article = makeArticle();
		const summaryByUrl = new Map<string, GeneratedSummary | undefined>([
			[
				ARTICLE_URL,
				{
					status: "ready",
					summary: "AI-generated summary.",
					excerpt: "Decision-helper blurb.",
				},
			],
		]);
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl,
		});

		expect(vm.articles[0].excerpt).toBe("Decision-helper blurb.");
	});

	it("should fall back to the metadata excerpt (not the AI summary) when the AI excerpt is absent (legacy ready row)", () => {
		const article = makeArticle();
		const summaryByUrl = new Map<string, GeneratedSummary | undefined>([
			[ARTICLE_URL, { status: "ready", summary: "Long AI summary." }],
		]);
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl,
		});

		expect(vm.articles[0].excerpt).toBe("An excerpt");
	});

	it("should fall back to the metadata excerpt when the summary is pending", () => {
		const article = makeArticle();
		const summaryByUrl = new Map<string, GeneratedSummary | undefined>([
			[ARTICLE_URL, { status: "pending" }],
		]);
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl,
		});

		expect(vm.articles[0].excerpt).toBe("An excerpt");
	});

	it("should fall back to the metadata excerpt when no summary record exists", () => {
		const article = makeArticle();
		const vm = toQueueViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl: new Map(),
		});

		expect(vm.articles[0].excerpt).toBe("An excerpt");
	});
});
