import { ReaderArticleHashIdSchema, SaveableUrlSchema } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/test-fixtures/providers/article-store";
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

function makeExistingRow(): GlobalArticleData {
	return {
		id: articleId,
		url: exampleUrl,
		metadata: { title: "Cached", siteName: "example.com", excerpt: "Cached", wordCount: 100 },
		estimatedReadTime: MinutesSchema.parse(1),
		savedAt: new Date(),
	};
}

interface CallTracker {
	saved: SavedArticle;
	calls: {
		markCrawlPending: number;
		markSummaryPending: number;
		publishUpdateFetchTimestamp: number;
		publishLinkSaved: number;
		publishStaleCheckRequested: number;
		updateArticleStatusUnread: number;
	};
	deps: SaveArticleFromUrlDependencies;
}

function makeTracker(params: {
	existing: GlobalArticleData | null;
	savedOverride?: SavedArticle;
}): CallTracker {
	const saved = params.savedOverride ?? makeSaved();
	const calls = {
		markCrawlPending: 0,
		markSummaryPending: 0,
		publishUpdateFetchTimestamp: 0,
		publishLinkSaved: 0,
		publishStaleCheckRequested: 0,
		updateArticleStatusUnread: 0,
	};
	const deps: SaveArticleFromUrlDependencies = {
		saveArticle: async () => saved,
		findArticleByUrl: async () => params.existing,
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
		publishStaleCheckRequested: async () => {
			calls.publishStaleCheckRequested += 1;
		},
	};
	return { saved, calls, deps };
}

describe("saveArticleFromUrl", () => {
	it("primes the crawl + summary pipeline for a brand-new URL and does not request a stale check", async () => {
		const tracker = makeTracker({ existing: null });

		await saveArticleFromUrl(tracker.deps, { userId, url: exampleUrl });

		expect(tracker.calls).toEqual({
			markCrawlPending: 1,
			markSummaryPending: 1,
			publishUpdateFetchTimestamp: 1,
			publishLinkSaved: 1,
			publishStaleCheckRequested: 0,
			updateArticleStatusUnread: 0,
		});
	});

	it("requests a stale check for an already-cached URL without re-priming the crawl pipeline", async () => {
		const tracker = makeTracker({ existing: makeExistingRow() });

		await saveArticleFromUrl(tracker.deps, { userId, url: exampleUrl });

		expect(tracker.calls).toEqual({
			markCrawlPending: 0,
			markSummaryPending: 0,
			publishUpdateFetchTimestamp: 0,
			publishLinkSaved: 0,
			publishStaleCheckRequested: 1,
			updateArticleStatusUnread: 0,
		});
	});

	it("flips a previously-read article back to unread when saving a brand-new URL", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker({ existing: null, savedOverride: previouslyRead });

		const result = await saveArticleFromUrl(tracker.deps, { userId, url: exampleUrl });

		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(result.saved.status).toBe("unread");
		expect(result.saved.readAt).toBeUndefined();
	});

	it("flips a previously-read article back to unread when re-saving an already-cached URL", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker({
			existing: makeExistingRow(),
			savedOverride: previouslyRead,
		});

		const result = await saveArticleFromUrl(tracker.deps, { userId, url: exampleUrl });

		expect(tracker.calls.publishStaleCheckRequested).toBe(1);
		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(result.saved.status).toBe("unread");
		expect(result.saved.readAt).toBeUndefined();
	});
});
