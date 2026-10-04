import { ReaderArticleHashIdSchema, SaveableUrlSchema, articleDestinationUrl, articleDisplayMetadata } from "@packages/domain/article";
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
const destination = articleDestinationUrl({ url: exampleUrl, displayUrl: undefined });
const provenance: SaveProvenance = { kind: "web" };
const operationSavedAt = new Date("2026-08-01T10:00:00.000Z");

function makeSaved(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url: exampleUrl,
		destinationUrl: destination,
		metadata: { ...articleDisplayMetadata({ url: exampleUrl, destinationUrl: destination, title: "", siteName: "", excerpt: "" }), wordCount: 0 },
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
		publishQueueEntryCreated: number;
		updateArticleStatusUnread: number;
		pinContentSource: number;
	};
	queueEntryCreated: Array<{ url: string; userId: string }>;
	deps: SaveArticleFromUrlDependencies;
}

function makeTracker(savedOverride?: SavedArticle): CallTracker {
	const saved = savedOverride ?? makeSaved();
	const queueEntryCreated: Array<{ url: string; userId: string }> = [];
	const calls = {
		markCrawlPending: 0,
		markSummaryPending: 0,
		publishUpdateFetchTimestamp: 0,
		publishLinkSaved: 0,
		publishLinkQueued: 0,
		publishQueueEntryCreated: 0,
		updateArticleStatusUnread: 0,
		pinContentSource: 0,
	};
	const deps: SaveArticleFromUrlDependencies = {
		saveArticle: async () => ({ saved, createdUserArticle: true, wroteUserArticle: true }),
		updateArticleStatus: async (_id, _u, status) => {
			if (status === "unread") calls.updateArticleStatusUnread += 1;
			return { ...saved, status, readAt: undefined };
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
		publishQueueEntryCreated: async (params) => {
			calls.publishQueueEntryCreated += 1;
			queueEntryCreated.push({ url: params.url, userId: params.userId });
		},
		refreshArticleIfStale: async () => ({ action: "new" }),
		resolveSaveIdentity: async (url) => ({ url }),
		pinContentSource: async () => {
			calls.pinContentSource += 1;
		},
	};
	return { saved, calls, queueEntryCreated, deps };
}

describe("saveArticleFromUrl", () => {
	it("primes the crawl + summary pipeline on a 'new' freshness verdict", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "new" },
		});

		expect(tracker.calls).toEqual({
			markCrawlPending: 1,
			markSummaryPending: 1,
			publishUpdateFetchTimestamp: 1,
			publishLinkSaved: 1,
			publishLinkQueued: 1,
			publishQueueEntryCreated: 1,
			updateArticleStatusUnread: 0,
			pinContentSource: 0,
		});
	});

	it("saves the bookmark and primes nothing when the link's host can never hold an article", async () => {
		const tracker = makeTracker();

		const result = await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: SaveableUrlSchema.parse("https://mail.google.com/mail/u/0/"),
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "new" },
		});

		expect(result.createdUserArticle).toBe(true);
		expect(tracker.calls).toEqual({
			markCrawlPending: 0,
			markSummaryPending: 0,
			publishUpdateFetchTimestamp: 0,
			publishLinkSaved: 0,
			publishLinkQueued: 1,
			publishQueueEntryCreated: 1,
			updateArticleStatusUnread: 0,
			pinContentSource: 0,
		});
	});

	it("re-marks a gated save unread when the reader had already read that bookmark", async () => {
		const tracker = makeTracker(makeSaved({ status: "read", readAt: operationSavedAt }));

		const result = await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: SaveableUrlSchema.parse("https://mail.google.com/mail/u/0/"),
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "new" },
		});

		expect(result.saved.status).toBe("unread");
		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(tracker.calls.publishLinkSaved).toBe(0);
	});

	it("keys the save + crawl + link-saved on the alias target when the URL resolves to a different identity", async () => {
		const tracker = makeTracker();
		const keyedOn: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveSaveIdentity: async () => ({ url: "https://example.com/canonical" }),
			saveArticle: async (p) => {
				keyedOn.push(`saveArticle:${p.url}`);
				return { saved: tracker.saved, createdUserArticle: true, wroteUserArticle: true };
			},
			markCrawlPending: async ({ url }) => {
				keyedOn.push(`markCrawlPending:${url}`);
			},
			publishLinkSaved: async ({ url }) => {
				keyedOn.push(`publishLinkSaved:${url}`);
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(keyedOn).toEqual([
			"saveArticle:https://example.com/canonical",
			"markCrawlPending:https://example.com/canonical",
			"publishLinkSaved:https://example.com/canonical",
		]);
	});

	it("keys the save on the identity the freshness probe already resolved, without resolving it again", async () => {
		const tracker = makeTracker();
		const resolved: string[] = [];
		const pinned: Array<{ articleUrl: string; contentSourceUrl: string }> = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveSaveIdentity: async (url) => {
				resolved.push(url);
				return { url };
			},
			pinContentSource: async (params) => {
				pinned.push(params);
			},
		};
		const identity = { url: "https://example.com/original", contentSourceUrl: "https://web.archive.org/web/https://example.com/original" };

		const result = await initSaveArticleFromUrl(deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "new", identity },
		});

		expect(result.canonicalUrl).toBe(identity.url);
		expect(pinned).toEqual([{ articleUrl: identity.url, contentSourceUrl: identity.contentSourceUrl }]);
		expect(resolved).toEqual([]);
	});

	it("asks to resurface earlier saves against the alias target, not the submitted URL", async () => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveSaveIdentity: async () => ({ url: "https://example.com/canonical" }),
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(tracker.queueEntryCreated).toEqual([
			{ url: "https://example.com/canonical", userId },
		]);
	});

	it("asks nothing when the save landed on a row the reader already had", async () => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: tracker.saved, createdUserArticle: false, wroteUserArticle: true }),
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(tracker.queueEntryCreated).toEqual([]);
	});

	it.each<{ provenance: SaveProvenance; asks: number }>([
		{ provenance: { kind: "web" }, asks: 1 },
		{ provenance: { kind: "client", clientName: "hutch-chrome-extension" }, asks: 1 },
		{ provenance: { kind: "email", senderEmail: "letter@example.com" }, asks: 1 },
		{ provenance: { kind: "mcp", registeredName: "claude" }, asks: 1 },
		{ provenance: { kind: "import" }, asks: 0 },
	])("asks $asks time(s) to resurface earlier saves for a $provenance.kind save", async ({ provenance: saveProvenance, asks }) => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance: saveProvenance,
			savedAt: operationSavedAt,
			freshness: { action: "new" },
		});

		expect(tracker.calls.publishQueueEntryCreated).toBe(asks);
	});

	it("announces the accepted save before asking to resurface earlier ones", async () => {
		const tracker = makeTracker();
		const order: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			publishLinkQueued: async () => {
				order.push("link-queued");
			},
			publishQueueEntryCreated: async () => {
				order.push("queue-entry-created");
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(order).toEqual(["link-queued", "queue-entry-created"]);
	});

	it("publishes a link saved event when 'refreshed' has fresh content", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
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
			savedAt: operationSavedAt,
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
			savedAt: operationSavedAt,
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
			savedAt: operationSavedAt,
			freshness: { action: "skip" },
		});

		expect(tracker.calls.publishLinkQueued).toBe(1);
	});

	it("announces the accepted save with the submitted URL, not the alias target", async () => {
		const tracker = makeTracker();
		const queued: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			resolveSaveIdentity: async () => ({ url: "https://example.com/canonical" }),
			publishLinkQueued: async ({ url }) => {
				queued.push(url);
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(queued).toEqual([exampleUrl]);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const } },
	])("reports the store's queue-entry verdict through $label", async ({ freshness }) => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: tracker.saved, createdUserArticle: false, wroteUserArticle: true }),
		};

		const result = await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness });

		expect(result.createdUserArticle).toBe(false);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const } },
	])("hands the operation's savedAt to the store verbatim on $label", async ({ freshness }) => {
		const tracker = makeTracker();
		const storeSavedAt: Date[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async (p) => {
				storeSavedAt.push(p.savedAt);
				return { saved: tracker.saved, createdUserArticle: true, wroteUserArticle: true };
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness });

		expect(storeSavedAt).toEqual([operationSavedAt]);
	});

	it("flips a previously-read article back to unread after a re-save", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker(previouslyRead);

		const result = await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "new" },
		});

		expect(tracker.calls.updateArticleStatusUnread).toBe(1);
		expect(result.saved.status).toBe("unread");
		expect(result.saved.readAt).toBeUndefined();
		expect(result.resurfacedFromRead).toBe(true);
	});

	it("reports no resurfacing when the re-saved row was still unread", async () => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: tracker.saved, createdUserArticle: false, wroteUserArticle: true }),
		};

		const result = await initSaveArticleFromUrl(deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
			freshness: { action: "skip" },
		});

		expect(result.resurfacedFromRead).toBe(false);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const } },
	])("leaves a newer save's read status alone when this save lost the position race, on $label", async ({ freshness }) => {
		const newerReadRow = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker(newerReadRow);
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: newerReadRow, createdUserArticle: false, wroteUserArticle: false }),
		};

		const result = await initSaveArticleFromUrl(deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt,
			freshness,
		});

		expect(tracker.calls.updateArticleStatusUnread).toBe(0);
		expect(result.saved.status).toBe("read");
		expect(result.resurfacedFromRead).toBe(false);
	});

	describe("an identity that carries a content source (an archive capture keyed on its original)", () => {
		const snapshot = "https://web.archive.org/web/20081203185222/https://example.com/post";

		it("pins the snapshot right after the row is written and before the crawl is primed", async () => {
			const tracker = makeTracker();
			const order: string[] = [];
			const deps: SaveArticleFromUrlDependencies = {
				...tracker.deps,
				resolveSaveIdentity: async (url) => ({ url, contentSourceUrl: snapshot }),
				saveArticle: async (p) => {
					order.push(`saveArticle:${p.url}`);
					return { saved: tracker.saved, createdUserArticle: true, wroteUserArticle: true };
				},
				pinContentSource: async ({ articleUrl, contentSourceUrl }) => {
					order.push(`pinContentSource:${articleUrl}→${contentSourceUrl}`);
				},
				markCrawlPending: async ({ url }) => {
					order.push(`markCrawlPending:${url}`);
				},
			};

			await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

			expect(order).toEqual([
				`saveArticle:${exampleUrl}`,
				`pinContentSource:${exampleUrl}→${snapshot}`,
				`markCrawlPending:${exampleUrl}`,
			]);
		});

		it("pins nothing on a 'skip' verdict — a row with live content is never re-pointed at the snapshot", async () => {
			const tracker = makeTracker();
			const deps: SaveArticleFromUrlDependencies = {
				...tracker.deps,
				resolveSaveIdentity: async (url) => ({ url, contentSourceUrl: snapshot }),
			};

			await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "skip" } });

			expect(tracker.calls.pinContentSource).toBe(0);
		});
	});

	it("pins nothing when the identity carries no content source", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, freshness: { action: "new" } });

		expect(tracker.calls.pinContentSource).toBe(0);
	});
});
