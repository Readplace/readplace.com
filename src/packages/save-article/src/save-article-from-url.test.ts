import { ReaderArticleHashIdSchema, SaveAttemptIdSchema, SaveableUrlSchema, articleDestinationUrl, articleDisplayMetadata } from "@packages/domain/article";
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
const saveAttemptId = SaveAttemptIdSchema.parse("save-attempt");
const operationSavedAt = new Date("2026-08-01T10:00:00.000Z");
const gmailUrl = SaveableUrlSchema.parse("https://mail.google.com/mail/u/0/");
const ownIdentity = { status: "resolved" as const, url: exampleUrl, originalUrl: exampleUrl };
const canonicalIdentity = { status: "resolved" as const, url: "https://example.com/canonical", originalUrl: "https://example.com/canonical" };

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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "new", identity: ownIdentity },
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
			url: gmailUrl,
			provenance,
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "new", identity: { status: "resolved", url: gmailUrl, originalUrl: gmailUrl } },
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
			url: gmailUrl,
			provenance,
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "new", identity: { status: "resolved", url: gmailUrl, originalUrl: gmailUrl } },
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

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: canonicalIdentity } });

		expect(keyedOn).toEqual([
			"saveArticle:https://example.com/canonical",
			"markCrawlPending:https://example.com/canonical",
			"publishLinkSaved:https://example.com/canonical",
		]);
	});

	it("asks to resurface earlier saves against the alias target, not the submitted URL", async () => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: canonicalIdentity } });

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

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: ownIdentity } });

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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "new", identity: ownIdentity },
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

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: ownIdentity } });

		expect(order).toEqual(["link-queued", "queue-entry-created"]);
	});

	it("publishes a link saved event when 'refreshed' has fresh content", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt, saveAttemptId,
			freshness: {
				action: "refreshed",
				identity: ownIdentity,
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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: {
				action: "refreshed",
				identity: ownIdentity,
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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "skip", identity: ownIdentity },
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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "skip", identity: ownIdentity },
		});

		expect(tracker.calls.publishLinkQueued).toBe(1);
	});

	it("announces the accepted save with the submitted URL, not the alias target", async () => {
		const tracker = makeTracker();
		const queued: string[] = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			publishLinkQueued: async ({ url }) => {
				queued.push(url);
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: canonicalIdentity } });

		expect(queued).toEqual([exampleUrl]);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const, identity: ownIdentity } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const, identity: ownIdentity } },
	])("reports the store's queue-entry verdict through $label", async ({ freshness }) => {
		const tracker = makeTracker();
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			saveArticle: async () => ({ saved: tracker.saved, createdUserArticle: false, wroteUserArticle: true }),
		};

		const result = await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness });

		expect(result.createdUserArticle).toBe(false);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const, identity: ownIdentity } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const, identity: ownIdentity } },
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

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness });

		expect(storeSavedAt).toEqual([operationSavedAt]);
	});

	it("flips a previously-read article back to unread after a re-save", async () => {
		const previouslyRead = makeSaved({ status: "read", readAt: new Date() });
		const tracker = makeTracker(previouslyRead);

		const result = await initSaveArticleFromUrl(tracker.deps)({
			userId,
			url: exampleUrl,
			provenance,
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "new", identity: ownIdentity },
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
			savedAt: operationSavedAt, saveAttemptId,
			freshness: { action: "skip", identity: ownIdentity },
		});

		expect(result.resurfacedFromRead).toBe(false);
	});

	it.each([
		{ label: "a 'new' verdict", freshness: { action: "new" as const, identity: ownIdentity } },
		{ label: "a 'skip' verdict", freshness: { action: "skip" as const, identity: ownIdentity } },
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
			savedAt: operationSavedAt, saveAttemptId,
			freshness,
		});

		expect(tracker.calls.updateArticleStatusUnread).toBe(0);
		expect(result.saved.status).toBe("read");
		expect(result.resurfacedFromRead).toBe(false);
	});

	describe("an identity that carries a content source (an archive capture keyed on its original)", () => {
		const snapshot = "https://web.archive.org/web/20081203185222/https://example.com/post";
		const snapshotIdentity = { ...ownIdentity, contentSourceUrl: snapshot, sourceOriginalUrl: exampleUrl };

		it("pins the snapshot right after the row is written and before the crawl is primed", async () => {
			const tracker = makeTracker();
			const order: string[] = [];
			const deps: SaveArticleFromUrlDependencies = {
				...tracker.deps,
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

			await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: snapshotIdentity } });

			expect(order).toEqual([
				`saveArticle:${exampleUrl}`,
				`pinContentSource:${exampleUrl}→${snapshot}`,
				`markCrawlPending:${exampleUrl}`,
			]);
		});

		it("asks for the snapshot to be crawled as a content candidate after priming the live crawl", async () => {
			const tracker = makeTracker();
			const linkSaves: Array<{ url: string; captureUrl?: string }> = [];
			const deps: SaveArticleFromUrlDependencies = {
				...tracker.deps,
				publishLinkSaved: async ({ url, captureUrl }) => {
					linkSaves.push({ url, captureUrl });
				},
			};

			await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: snapshotIdentity } });

			expect(linkSaves).toEqual([
				{ url: exampleUrl, captureUrl: snapshot },
			]);
		});

		it.each([
			{ label: "a 'skip' verdict", freshness: { action: "skip" as const, identity: ownIdentity } },
			{ label: "an 'unchanged' verdict", freshness: { action: "unchanged" as const, identity: ownIdentity } },
		])("records the snapshot and offers it to the content judge on $label, without re-priming the live crawl", async ({ freshness }) => {
			const tracker = makeTracker();
			const pinned: Array<{ articleUrl: string; contentSourceUrl: string }> = [];
			const linkSaves: Array<{ url: string; captureUrl?: string }> = [];
			const deps: SaveArticleFromUrlDependencies = {
				...tracker.deps,
				pinContentSource: async (params) => {
					pinned.push(params);
				},
				publishLinkSaved: async ({ url, captureUrl }) => {
					linkSaves.push({ url, captureUrl });
				},
			};

			await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { ...freshness, identity: snapshotIdentity } });

			expect(pinned).toEqual([{ articleUrl: exampleUrl, contentSourceUrl: snapshot, sourceOriginalUrl: exampleUrl }]);
			expect(linkSaves).toEqual([{ url: exampleUrl, captureUrl: snapshot }]);
			expect(tracker.calls.markCrawlPending).toBe(0);
		});
	});

	it.each([
		{ label: "a new article", freshness: { action: "new" as const, identity: ownIdentity } },
		{ label: "an existing article", freshness: { action: "skip" as const, identity: ownIdentity } },
	])("offers a tracker body to the content judge for $label without pinning it as the article's source", async ({ freshness }) => {
		const trackerUrl = "https://javascriptweekly.com/link/100000/rss";
		const tracker = makeTracker();
		const linkSaves: Array<{ url: string; captureUrl?: string; sourceOriginalUrl?: string }> = [];
		const deps: SaveArticleFromUrlDependencies = {
			...tracker.deps,
			publishLinkSaved: async ({ url, captureUrl, sourceOriginalUrl }) => {
				linkSaves.push({ url, captureUrl, sourceOriginalUrl });
			},
		};

		await initSaveArticleFromUrl(deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { ...freshness, identity: { ...ownIdentity, contentSourceUrl: trackerUrl, sourceOriginalUrl: exampleUrl } } });

		expect(tracker.calls.pinContentSource).toBe(0);
		expect(linkSaves).toEqual([{ url: exampleUrl, captureUrl: trackerUrl, sourceOriginalUrl: exampleUrl }]);
	});

	it("pins nothing when the identity carries no content source", async () => {
		const tracker = makeTracker();

		await initSaveArticleFromUrl(tracker.deps)({ userId, url: exampleUrl, provenance, savedAt: operationSavedAt, saveAttemptId, freshness: { action: "new", identity: ownIdentity } });

		expect(tracker.calls.pinContentSource).toBe(0);
	});
});
