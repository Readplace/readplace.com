import { ReaderArticleHashIdSchema, SaveableUrlSchema } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SaveProvenance, SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	initSaveArticleFromUrl,
	type SaveArticleFromUrlDependencies,
} from "./save-article-from-url";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");
const provenance: SaveProvenance = { kind: "web" };

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
		publishLinkQueued: number;
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
		publishLinkQueued: 0,
		updateArticleStatusUnread: 0,
	};
	const deps: SaveArticleFromUrlDependencies = {
		saveArticle: async () => ({ saved, createdUserArticle: true }),
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
		publishLinkQueued: async () => {
			calls.publishLinkQueued += 1;
		},
		refreshArticleIfStale: async () => ({ action: "new" }),
		resolveCanonicalIdentity: async (url) => url,
	};
	return { saved, calls, deps };
}

describe("saveArticleFromUrl", () => {
	it("primes the crawl + summary pipeline on a 'new' freshness verdict", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			freshness: { action: "new" },
		});

		expect(tracker.calls).toEqual({
			markCrawlPending: 1,
			markSummaryPending: 1,
			publishUpdateFetchTimestamp: 1,
			publishLinkSaved: 1,
			publishLinkQueued: 1,
			updateArticleStatusUnread: 0,
		});
	});

	it("keys the save + crawl + link-saved on the alias target when the URL resolves to a different identity", async () => {
		const tracker = makeTracker();
		const keyedOn: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveCanonicalIdentity: async () => "https://example.com/canonical",
			saveArticle: async (p) => {
				keyedOn.push(`saveArticle:${p.url}`);
				return { saved: tracker.saved, createdUserArticle: true };
			},
			markCrawlPending: async ({ url }) => {
				keyedOn.push(`markCrawlPending:${url}`);
			},
			publishLinkSaved: async ({ url }) => {
				keyedOn.push(`publishLinkSaved:${url}`);
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, freshness: { action: "new" } });

		expect(keyedOn).toEqual([
			"saveArticle:https://example.com/canonical",
			"markCrawlPending:https://example.com/canonical",
			"publishLinkSaved:https://example.com/canonical",
		]);
	});

	it("publishes a link saved event when 'refreshed' has fresh content", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
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

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
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

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			freshness: { action: "skip" },
		});

		expect(tracker.calls.publishLinkSaved).toBe(0);
		expect(tracker.calls.markCrawlPending).toBe(0);
	});

	it("announces the accepted save on a 'skip' verdict, where no link-saved fires", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			freshness: { action: "skip" },
		});

		expect(tracker.calls.publishLinkQueued).toBe(1);
	});

	it("announces the accepted save with the submitted URL, not the alias target", async () => {
		const tracker = makeTracker();
		const queued: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveCanonicalIdentity: async () => "https://example.com/canonical",
			publishLinkQueued: async ({ url }) => {
				queued.push(url);
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, freshness: { action: "new" } });

		expect(queued).toEqual([exampleUrl]);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const } },
	])("reports the store's queue-entry verdict through $label", async ({ freshness }) => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: tracker.saved, createdUserArticle: false }),
		};

		const result = await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, freshness });

		expect(result.createdUserArticle).toBe(false);
	});

	it("flips a previously-read article back to unread after a re-save", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker(previouslyRead);

		const result = await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			freshness: { action: "new" },
		});

		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(result.saved.status).toBe("unread");
		expect(result.saved.readAt).toBeUndefined();
	});
});
