import assert from "node:assert/strict";
import type {
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId, toArticleTopics } from "@packages/domain/article";
import { DEFAULT_READLIST, DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import type { FindArticlesResult } from "@packages/test-fixtures/providers/article-store";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { toReadlistArticleViewModel, toReadlistViewModel } from "./readlist.viewmodel";

const ARTICLE_URL = "https://example.com/post";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL).value;

function makeArticle(overrides?: Partial<SavedArticle>): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "user-1" as UserId,
		url: ARTICLE_URL,
		destinationUrl: destinationUrl(ARTICLE_URL),
		metadata: {
			title: "Test Article",
			siteName: siteLabel("example.com"),
			excerpt: "An excerpt",
			wordCount: 500,
		},
		estimatedReadTime: 3 as Minutes,
		status: "unread",
		savedAt: new Date("2025-06-01T12:00:00Z"),
		...overrides,
	};
}

function makeResult(articles: SavedArticle[]): FindArticlesResult {
	return {
		articles,
		hasMore: false,
		page: 1,
		pageSize: 20,
	};
}

const NOW = new Date("2025-06-01T13:00:00Z");
const DEFAULT_FILTERS = { readlist: DEFAULT_READLIST_SLUG, tab: "queue" as const, order: "desc" as const, page: 1 };

describe("toReadlistViewModel", () => {
	it("passes readlist identities through to the status confirmation", () => {
		const readlists = [DEFAULT_READLIST, { slug: ReadlistSlugSchema.parse("work"), label: "Work" }];
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			confirmReadlistsByUrl: new Map([[ARTICLE_URL, readlists]]),
		});

		expect(vm.articles[0].markStatusConfirm?.readlists).toEqual(readlists);
	});

	it("should map article fields to view model", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].title).toBe("Test Article");
		expect(vm.articles[0].siteName).toBe("example.com");
		expect(vm.articles[0].url).toBe("https://example.com/post");
	});

	it("shows the redirect destination as the card url for a merged article", () => {
		const vm = toReadlistViewModel(
			makeResult([makeArticle({ url: "https://example.com/post.html", destinationUrl: destinationUrl("https://example.com/post") })]),
			DEFAULT_FILTERS,
			{ now: NOW },
		);

		expect(vm.articles[0].url).toBe("https://example.com/post");
	});

	it("should format relative date as hours ago", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].saved.label).toBe("1h ago");
		expect(vm.articles[0].saved.mode).toBe("relative");
	});

	it("should format recent date as minutes ago", () => {
		const article = makeArticle({
			savedAt: new Date("2025-06-01T12:50:00Z"),
		});
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].saved.label).toBe("10m ago");
	});

	it("should offer a next page and no prev page on the first page when more rows exist", () => {
		const result: FindArticlesResult = {
			articles: [],
			hasMore: true,
			page: 1,
			pageSize: 20,
		};
		const vm = toReadlistViewModel(result, DEFAULT_FILTERS, { now: NOW });

		expect(vm.paginationUrls.next).toBe("/queue?page=2");
		expect(vm.paginationUrls.prev).toBeUndefined();
	});

	it("should set isEmpty when no articles", () => {
		const vm = toReadlistViewModel(makeResult([]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.isEmpty).toBe(true);
	});

	it("should set isEmpty for an empty page even when the query counted a non-zero total", () => {
		const result: FindArticlesResult = {
			articles: [],
			total: 45,
			hasMore: false,
			page: 3,
			pageSize: 20,
		};
		const vm = toReadlistViewModel(result, { ...DEFAULT_FILTERS, page: 3 }, { now: NOW });

		expect(vm.isEmpty).toBe(true);
	});

	it("should leave statusFlash undefined when not provided", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.statusFlash).toBeUndefined();
	});

	it("should build a statusFlash undo URL that posts back to the article status route", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			statusFlash: { message: "Marked as read", undoArticleId: ARTICLE_ID, undoStatus: "unread" },
		});

		expect(vm.statusFlash).toEqual({
			message: "Marked as read",
			undoUrl: `/queue/${ARTICLE_ID}/status`,
			undoStatus: "unread",
		});
	});

	it("should preserve the filter context in the statusFlash undo URL", () => {
		const filters = { readlist: DEFAULT_READLIST_SLUG, tab: "done" as const, order: "asc" as const, page: 1 };
		const vm = toReadlistViewModel(makeResult([makeArticle({ status: "read" })]), filters, {
			now: NOW,
			statusFlash: { message: "Marked as unread", undoArticleId: ARTICLE_ID, undoStatus: "read" },
		});

		expect(vm.statusFlash?.undoUrl).toBe(`/queue/${ARTICLE_ID}/status?tab=done&order=asc`);
	});

	it("should format relative date as days ago", () => {
		const article = makeArticle({
			savedAt: new Date("2025-05-29T12:00:00Z"),
		});
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].saved.label).toBe("3d ago");
	});

	it("should format date older than 30 days as full date", () => {
		const article = makeArticle({
			savedAt: new Date("2025-04-01T12:00:00Z"),
		});
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].saved).toEqual({
			iso: "2025-04-01T12:00:00.000Z",
			label: "Apr 1, 2025",
			mode: "date",
		});
	});

	it("should format very recent date as just now", () => {
		const article = makeArticle({
			savedAt: new Date("2025-06-01T12:59:50Z"),
		});
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
		});

		expect(vm.articles[0].saved.label).toBe("just now");
	});

	it("should generate next pagination URL when more pages exist", () => {
		const result: FindArticlesResult = {
			articles: [],
			hasMore: true,
			page: 1,
			pageSize: 20,
		};
		const vm = toReadlistViewModel(result, DEFAULT_FILTERS, { now: NOW });

		expect(vm.paginationUrls.next).toBe("/queue?page=2");
	});

	it("should generate prev pagination URL on page 2", () => {
		const result: FindArticlesResult = {
			articles: [],
			hasMore: true,
			page: 2,
			pageSize: 20,
		};
		const vm = toReadlistViewModel(result, { ...DEFAULT_FILTERS, page: 2 }, { now: NOW });

		expect(vm.paginationUrls.prev).toBe("/queue");
	});

	it("should not generate next pagination URL when no more rows exist", () => {
		const result: FindArticlesResult = {
			articles: [],
			hasMore: false,
			page: 3,
			pageSize: 20,
		};
		const vm = toReadlistViewModel(result, { ...DEFAULT_FILTERS, page: 3 }, { now: NOW });

		expect(vm.paginationUrls.next).toBeUndefined();
	});

	it("should pass errors through to view model", () => {
		const vm = toReadlistViewModel(makeResult([]), DEFAULT_FILTERS, {
			now: NOW,
			errors: [{ message: "Could not parse article: Invalid URL" }],
		});

		expect(vm.errors?.[0]?.message).toBe("Could not parse article: Invalid URL");
	});

	it("should generate mark-read and delete actions for unread article", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const actions = vm.articles[0].actions;
		expect(actions.map(a => a.testAction)).toEqual(["mark-read", "delete"]);
	});

	it("should generate mark-unread and delete actions for read article", () => {
		const article = makeArticle({ status: "read" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const actions = vm.articles[0].actions;
		expect(actions.map(a => a.testAction)).toEqual(["mark-unread", "delete"]);
	});

	it("should include return query in action URLs for non-default view", () => {
		const article = makeArticle({ status: "read" });
		const filters = { readlist: DEFAULT_READLIST_SLUG, order: "asc" as const, page: 1, tab: "done" as const };
		const vm = toReadlistViewModel(makeResult([article]), filters, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.url).toBe(`/queue/${ARTICLE_ID}/delete?tab=done&order=asc`);
	});

	it("should not include query string in action URLs for default view", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.url).toBe(`/queue/${ARTICLE_ID}/delete`);
	});

	it("should use POST method and /status URL for mark-unread action", () => {
		const article = makeArticle({ status: "read" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const markUnreadAction = vm.articles[0].actions.find(a => a.testAction === "mark-unread");
		expect(markUnreadAction?.method).toBe("POST");
		expect(markUnreadAction?.url).toBe(`/queue/${ARTICLE_ID}/status?swap=card`);
		expect(markUnreadAction?.fields).toEqual([{ name: "status", value: "unread" }]);
	});

	it("should use POST method and /status URL for mark-read action", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const markReadAction = vm.articles[0].actions.find(a => a.testAction === "mark-read");
		expect(markReadAction?.method).toBe("POST");
		expect(markReadAction?.url).toBe(`/queue/${ARTICLE_ID}/status?swap=card`);
		expect(markReadAction?.fields).toEqual([{ name: "status", value: "read" }]);
	});

	it("should include return query in mark-read URL for non-default view", () => {
		const article = makeArticle({ status: "unread" });
		const filters = { readlist: DEFAULT_READLIST_SLUG, order: "asc" as const, page: 1, tab: "queue" as const };
		const vm = toReadlistViewModel(makeResult([article]), filters, { now: NOW });

		const markReadAction = vm.articles[0].actions.find(a => a.testAction === "mark-read");
		expect(markReadAction?.url).toBe(`/queue/${ARTICLE_ID}/status?order=asc&swap=card`);
	});

	it("should have no hidden fields in delete action", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const deleteAction = vm.articles[0].actions.find(a => a.testAction === "delete");
		expect(deleteAction?.fields).toEqual([]);
	});

	it("should use POST for all actions", () => {
		const article = makeArticle({ status: "unread" });
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, { now: NOW });

		const methods = vm.articles[0].actions.map(a => a.method);
		expect(methods).toEqual(["POST", "POST"]);
	});

	it("should expose the counts URL for the active filters", () => {
		const vm = toReadlistViewModel(makeResult([]), { readlist: DEFAULT_READLIST_SLUG, tab: "done", order: "asc", page: 2 }, { now: NOW });

		expect(vm.countsUrl).toBe("/queue/counts?tab=done&order=asc&page=2");
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
					topics: [],
				},
			],
		]);
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl,
		});

		expect(vm.articles[0].excerpt).toBe("Decision-helper blurb.");
	});

	it("should fall back to the metadata excerpt (not the AI summary) when the AI excerpt is absent (legacy ready row)", () => {
		const article = makeArticle();
		const summaryByUrl = new Map<string, GeneratedSummary | undefined>([
			[ARTICLE_URL, { status: "ready", summary: "Long AI summary.", topics: [] }],
		]);
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
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
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl,
		});

		expect(vm.articles[0].excerpt).toBe("An excerpt");
	});

	it("should fall back to the metadata excerpt when no summary record exists", () => {
		const article = makeArticle();
		const vm = toReadlistViewModel(makeResult([article]), DEFAULT_FILTERS, {
			now: NOW,
			summaryByUrl: new Map(),
		});

		expect(vm.articles[0].excerpt).toBe("An excerpt");
	});
});

describe("toReadlistArticleViewModel — isStalePending", () => {
	const baseParams = {
		article: makeArticle(),
		now: NOW,
		returnQuery: "",
		summary: undefined,
		filters: DEFAULT_FILTERS,
		maxPolls: 3,
	};

	it("is false on the first tick of a normal pending row (polling continues)", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			crawl: { status: "pending" },
			pollCount: 1,
		});
		expect(vm.isStalePending).toBe(false);
		expect(vm.cardPollUrl).toBeDefined();
	});

	it("is true once the pending row has exhausted the poll cap (cardPollUrl drops)", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			crawl: { status: "pending" },
			pollCount: 4,
		});
		expect(vm.isStalePending).toBe(true);
		expect(vm.cardPollUrl).toBeUndefined();
	});

	it("is false for terminal failed rows (the reader-failure page handles the click-through)", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			crawl: { status: "failed", reason: "x" },
			pollCount: 4,
		});
		expect(vm.isStalePending).toBe(false);
		expect(vm.cardPollUrl).toBeUndefined();
	});

	it("is false for terminal unsupported rows", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			crawl: { status: "unsupported", reason: "x" },
			pollCount: 4,
		});
		expect(vm.isStalePending).toBe(false);
		expect(vm.cardPollUrl).toBeUndefined();
	});

	it("is false for ready rows whose summary has also settled", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "ok", topics: [] },
			pollCount: 4,
		});
		expect(vm.isStalePending).toBe(false);
	});
});

describe("toReadlistArticleViewModel — topics", () => {
	const baseParams = {
		article: makeArticle(),
		now: NOW,
		returnQuery: "",
		crawl: { status: "ready" as const },
		filters: DEFAULT_FILTERS,
		maxPolls: 3,
	};

	it("carries the topics of a ready summary in the order they were named", () => {
		const vm = toReadlistArticleViewModel({
			...baseParams,
			summary: {
				status: "ready",
				summary: "AI-generated summary.",
				topics: toArticleTopics(["Productivity", "Focus", "Lifestyle"]),
			},
		});

		expect(vm.topics).toEqual(["Productivity", "Focus", "Lifestyle"]);
	});

	const summariesWithoutTopics: Array<[string, GeneratedSummary | undefined]> = [
		["absent", undefined],
		["pending", { status: "pending" }],
		["failed", { status: "failed", reason: "model-error" }],
		["skipped", { status: "skipped", reason: "content-too-short" }],
	];

	it.each(summariesWithoutTopics)("has no topics when the summary is %s", (_label, summary) => {
		const vm = toReadlistArticleViewModel({ ...baseParams, summary });

		expect(vm.topics).toEqual([]);
	});
});

describe("toReadlistArticleViewModel — versioned reader href", () => {
	function readerVersion(readerHref: string): string | null {
		return new URL(readerHref, "https://internal.invalid").searchParams.get("v");
	}

	it("stamps a content version on the reader link", () => {
		const vm = toReadlistArticleViewModel({
			article: makeArticle(),
			now: NOW,
			returnQuery: "",
			summary: undefined,
			crawl: { status: "ready" },
			filters: DEFAULT_FILTERS,
			maxPolls: 3,
		});
		const version = readerVersion(vm.readerHref);
		assert(version, "the reader href must carry a v param");
		expect(version).toMatch(/^[0-9a-f]{16}$/);
		expect(vm.readerHref).toBe(`/queue/${ARTICLE_ID}/view?v=${version}`);
	});

	it("orders the queue slug before the version for a non-default readlist", () => {
		const vm = toReadlistArticleViewModel({
			article: makeArticle(),
			now: NOW,
			returnQuery: "",
			summary: undefined,
			crawl: { status: "ready" },
			filters: { readlist: ReadlistSlugSchema.parse("reading"), tab: "queue", order: "desc", page: 1 },
			maxPolls: 3,
		});
		expect(vm.readerHref).toMatch(new RegExp(`^/queue/${ARTICLE_ID}/view\\?queue=reading&v=[0-9a-f]{16}$`));
	});

	it("changes the version when the summary settles", () => {
		const base = {
			article: makeArticle(),
			now: NOW,
			returnQuery: "",
			crawl: { status: "ready" as const },
			filters: DEFAULT_FILTERS,
			maxPolls: 3,
		};
		const pending = toReadlistArticleViewModel({ ...base, summary: undefined });
		const ready = toReadlistArticleViewModel({ ...base, summary: { status: "ready", summary: "TL;DR", topics: [] } });
		expect(readerVersion(pending.readerHref)).not.toBe(readerVersion(ready.readerHref));
	});

	it("changes the version when contentFetchedAt advances", () => {
		const base = {
			now: NOW,
			returnQuery: "",
			summary: undefined,
			crawl: { status: "ready" as const },
			filters: DEFAULT_FILTERS,
			maxPolls: 3,
		};
		const earlier = toReadlistArticleViewModel({
			...base,
			article: makeArticle({ contentFetchedAt: new Date("2026-01-01T00:00:00Z") }),
		});
		const later = toReadlistArticleViewModel({
			...base,
			article: makeArticle({ contentFetchedAt: new Date("2026-02-01T00:00:00Z") }),
		});
		expect(readerVersion(earlier.readerHref)).not.toBe(readerVersion(later.readerHref));
	});
});

describe("toReadlistViewModel — move", () => {
	const work = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };
	const finance = { slug: ReadlistSlugSchema.parse("finance"), label: "Finance & Tax" };
	const weekend = { slug: ReadlistSlugSchema.parse("weekend"), label: "Weekend" };
	const readlists = [DEFAULT_READLIST, work, finance, weekend];
	const onWork = { ...DEFAULT_FILTERS, readlist: work.slug };

	function customReadlists(count: number) {
		return Array.from({ length: count }, (_, index) => ({
			slug: ReadlistSlugSchema.parse(`shelf-${index + 1}`),
			label: `Shelf ${index + 1}`,
		}));
	}

	it("offers no move without the reader's readlists", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.articles[0].move).toBeUndefined();
	});

	it("adds an article on All to each custom readlist that does not hold it yet, in rail order", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			readlists,
			savesByUrl: new Map([[ARTICLE_URL, [{}, { readlist: finance.slug }]]]),
		});

		expect(vm.articles[0].move).toEqual({
			articleId: ARTICLE_ID,
			popoverId: `readlist-move-${ARTICLE_ID}`,
			mode: "add",
			from: DEFAULT_READLIST_SLUG,
			url: `/queue/${ARTICLE_ID}/move`,
			destinations: [work, weekend],
			create: { popoverId: `readlist-create-move-${ARTICLE_ID}` },
			opens: `readlist-move-${ARTICLE_ID}`,
		});
	});

	it("moves an article out of a custom readlist to the others that do not hold it, keeping the return query", () => {
		const filters = { readlist: work.slug, tab: "done" as const, order: "asc" as const, page: 2 };
		const vm = toReadlistViewModel(makeResult([makeArticle({ status: "read" })]), filters, {
			now: NOW,
			readlists,
			savesByUrl: new Map([[ARTICLE_URL, [{}, { readlist: work.slug }, { readlist: weekend.slug }]]]),
		});

		expect(vm.articles[0].move).toEqual({
			articleId: ARTICLE_ID,
			popoverId: `readlist-move-${ARTICLE_ID}`,
			mode: "move",
			from: work.slug,
			url: `/queue/${ARTICLE_ID}/move?queue=work&tab=done&order=asc&page=2`,
			destinations: [finance],
			create: { popoverId: `readlist-create-move-${ARTICLE_ID}` },
			opens: `readlist-move-${ARTICLE_ID}`,
		});
	});

	it("leaves out the readlist being viewed even when no membership was fetched for the article", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), onWork, {
			now: NOW,
			readlists,
			savesByUrl: new Map(),
		});

		expect(vm.articles[0].move?.destinations).toEqual([finance, weekend]);
	});

	it("opens the create dialog straight from the item for a reader whose only readlist is All", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			readlists: [DEFAULT_READLIST],
		});

		expect(vm.articles[0].move).toEqual({
			articleId: ARTICLE_ID,
			popoverId: `readlist-move-${ARTICLE_ID}`,
			mode: "add",
			from: DEFAULT_READLIST_SLUG,
			url: `/queue/${ARTICLE_ID}/move`,
			destinations: [],
			create: { popoverId: `readlist-create-move-${ARTICLE_ID}` },
			opens: `readlist-create-move-${ARTICLE_ID}`,
		});
	});

	it("opens the create dialog straight from the item once every other custom readlist holds the article", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), onWork, {
			now: NOW,
			readlists,
			savesByUrl: new Map([
				[ARTICLE_URL, [{}, { readlist: work.slug }, { readlist: finance.slug }, { readlist: weekend.slug }]],
			]),
		});

		expect(vm.articles[0].move?.destinations).toEqual([]);
		expect(vm.articles[0].move?.opens).toBe(`readlist-create-move-${ARTICLE_ID}`);
	});

	it("offers to create a readlist while the reader has fewer custom readlists than the cap", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			readlists: [DEFAULT_READLIST, ...customReadlists(6)],
		});

		expect(vm.articles[0].move?.create).toEqual({ popoverId: `readlist-create-move-${ARTICLE_ID}` });
		expect(vm.articles[0].move?.destinations).toHaveLength(6);
	});

	it("keeps the chooser but drops the create row once the reader is at the cap", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			readlists: [DEFAULT_READLIST, ...customReadlists(7)],
		});

		expect(vm.articles[0].move?.create).toBeUndefined();
		expect(vm.articles[0].move?.destinations).toHaveLength(7);
		expect(vm.articles[0].move?.opens).toBe(`readlist-move-${ARTICLE_ID}`);
	});

	it("offers no move at the cap once every other custom readlist holds the article", () => {
		const shelves = customReadlists(7);
		const vm = toReadlistViewModel(makeResult([makeArticle()]), { ...DEFAULT_FILTERS, readlist: shelves[0].slug }, {
			now: NOW,
			readlists: [DEFAULT_READLIST, ...shelves],
			savesByUrl: new Map([[ARTICLE_URL, [{}, ...shelves.map((shelf) => ({ readlist: shelf.slug }))]]]),
		});

		expect(vm.articles[0].move).toBeUndefined();
	});

	it("offers no move to a read-only account", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, {
			now: NOW,
			readlists,
			savesByUrl: new Map([[ARTICLE_URL, [{}]]]),
			effectiveAccess: { tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
		});

		expect(vm.accessIsReadOnly).toBe(true);
		expect(vm.articles[0].move).toBeUndefined();
	});

	it("leaves moveFlash undefined when not provided", () => {
		const vm = toReadlistViewModel(makeResult([makeArticle()]), DEFAULT_FILTERS, { now: NOW });

		expect(vm.moveFlash).toBeUndefined();
	});

	it("builds the move toast's Undo against the move route, keeping the page the reader was on", () => {
		const filters = { readlist: work.slug, tab: "done" as const, order: "asc" as const, page: 2 };
		const vm = toReadlistViewModel(makeResult([makeArticle({ status: "read" })]), filters, {
			now: NOW,
			moveFlash: {
				articleId: ARTICLE_ID,
				message: "Moved to Finance & Tax",
				undoFrom: finance.slug,
				undoTo: work.slug,
			},
		});

		expect(vm.moveFlash).toEqual({
			message: "Moved to Finance & Tax",
			undoUrl: `/queue/${ARTICLE_ID}/move?queue=work&tab=done&order=asc&page=2`,
			undoFields: { from: "finance", to: "work" },
		});
	});
});
