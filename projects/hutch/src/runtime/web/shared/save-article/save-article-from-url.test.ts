import { ReaderArticleHashIdSchema, SaveableUrlSchema } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	saveArticleFromUrl,
	type SaveArticleFromUrlDependencies,
} from "./save-article-from-url";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");

function makeSaved(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url: exampleUrl,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		status: "unread",
		savedAt: new Date(),
		...overrides,
	};
}

interface CallTracker {
	saved: SavedArticle;
	calls: {
		markCrawlPending: number;
		markSummaryPending: number;
		publishUpdateFetchTimestamp: number;
		publishLinkSaved: number;
		updateArticleStatusUnread: number;
	};
	deps: SaveArticleFromUrlDependencies;
}

function makeTracker(savedOverride?: SavedArticle): CallTracker {
	const saved = savedOverride ?? makeSaved();
	const calls = {
		markCrawlPending: 0,
		markSummaryPending: 0,
		publishUpdateFetchTimestamp: 0,
		publishLinkSaved: 0,
		updateArticleStatusUnread: 0,
	};
	const deps: SaveArticleFromUrlDependencies = {
		saveArticle: async () => saved,
		updateArticleStatus: async (_id, _u, status) => {
			if (status === "unread") calls.updateArticleStatusUnread += 1;
			return true;
		},
		markCrawlPending: async () => {
			calls.markCrawlPending += 1;
		},
		markSummaryPending: async () => {
			calls.markSummaryPending += 1;
		},
		publishUpdateFetchTimestamp: async () => {
			calls.publishUpdateFetchTimestamp += 1;
		},
		publishLinkSaved: async () => {
			calls.publishLinkSaved += 1;
		},
		refreshArticleIfStale: async () => ({ action: "new" }),
	};
	return { saved, calls, deps };
}

describe("saveArticleFromUrl", () => {
	it("primes the crawl + summary pipeline on a 'new' freshness verdict", async () => {
		const tracker = makeTracker();

		await saveArticleFromUrl(tracker.deps, {
			userId,
			url: exampleUrl,
			freshness: { action: "new" },
		});

		expect(tracker.calls).toEqual({
			markCrawlPending: 1,
			markSummaryPending: 1,
			publishUpdateFetchTimestamp: 1,
			publishLinkSaved: 1,
			updateArticleStatusUnread: 0,
		});
	});

	it("publishes a link saved event when 'refreshed' has fresh content", async () => {
		const tracker = makeTracker();

		await saveArticleFromUrl(tracker.deps, {
			userId,
			url: exampleUrl,
			freshness: {
				action: "refreshed",
				article: {
					ok: true,
					article: {
						title: "t",
						siteName: "s",
						excerpt: "e",
						wordCount: 100,
						content: "<p>hi</p>",
					},
				},
			},
		});

		expect(tracker.calls.markSummaryPending).toBe(1);
		expect(tracker.calls.publishLinkSaved).toBe(1);
		expect(tracker.calls.markCrawlPending).toBe(0);
	});

	it("does not publish on 'refreshed' verdicts whose article has no content", async () => {
		const tracker = makeTracker();

		await saveArticleFromUrl(tracker.deps, {
			userId,
			url: exampleUrl,
			freshness: {
				action: "refreshed",
				article: {
					ok: true,
					article: {
						title: "t",
						siteName: "s",
						excerpt: "e",
						wordCount: 0,
						content: "",
					},
				},
			},
		});

		expect(tracker.calls.publishLinkSaved).toBe(0);
		expect(tracker.calls.markSummaryPending).toBe(0);
	});

	it("does not publish or re-prime on 'skip' or 'unchanged' verdicts", async () => {
		const tracker = makeTracker();

		await saveArticleFromUrl(tracker.deps, {
			userId,
			url: exampleUrl,
			freshness: { action: "skip" },
		});

		expect(tracker.calls.publishLinkSaved).toBe(0);
		expect(tracker.calls.markCrawlPending).toBe(0);
	});

	it("flips a previously-read article back to unread after a re-save", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker(previouslyRead);

		const result = await saveArticleFromUrl(tracker.deps, {
			userId,
			url: exampleUrl,
			freshness: { action: "new" },
		});

		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(result.saved.status).toBe("unread");
		expect(result.saved.readAt).toBeUndefined();
	});
});
