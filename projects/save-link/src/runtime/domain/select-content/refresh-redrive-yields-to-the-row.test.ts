import { CandidateIdSchema, SaveAttemptIdSchema, type CandidateId, type SaveAttemptId } from "@packages/domain/article";
import { type Article, type Effect, initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { noopLogger } from "@packages/logger";
import { candidateProvenance, type TierSource, type VerifiedTierSource } from "@packages/tier-source";
import { initSelectContentWork } from "./select-content-work";
import { initListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { ReadTierSource, WriteCanonicalContent } from "./tier-source-access.types";
import type { RecordCrawlVersion } from "./crawl-versions";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-03T00:00:00.000Z";
const STAMP_AFTER_T1 = "2026-10-02T12:00:00.000Z";
const EPOCH = new Date(0).toISOString();
const A0 = SaveAttemptIdSchema.parse("attempt-0");
const A1 = SaveAttemptIdSchema.parse("attempt-1");
const A2 = SaveAttemptIdSchema.parse("attempt-2");
const METADATA = { title: "Article", siteName: "example.com", excerpt: "", wordCount: 50, estimatedReadTime: 1 };
const REFUSED = "[RefreshContentExtracted] refused";

function candidate(params: { id: string; attemptId: SaveAttemptId; fetchedAt: string; directResourceKind?: "plain-text" }): VerifiedTierSource {
	const html = `<article><p>The body ${params.id} fetched at ${params.fetchedAt}.</p></article>`;
	return {
		tier: "tier-1", html,
		metadata: {
			...candidateProvenance({ metadata: METADATA, html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: params.fetchedAt, httpStatus: 200 }),
			id: CandidateIdSchema.parse(params.id), directResourceKind: params.directResourceKind,
		},
	};
}

const C0 = candidate({ id: "c0", attemptId: A0, fetchedAt: T0 });
const C1 = candidate({ id: "c1", attemptId: A1, fetchedAt: T1 });
const C1_DIRECT = candidate({ id: "c1", attemptId: A1, fetchedAt: T1, directResourceKind: "plain-text" });
const C2 = candidate({ id: "c2", attemptId: A2, fetchedAt: T2 });
const hashOf = (source: VerifiedTierSource) => computeCanonicalContentHash(source.html);
const locationOf = (id: CandidateId) => `s3://content/${id}.html`;

function committedTo(params: { source: VerifiedTierSource; freshness: Omit<Article["freshness"], "canonicalContentHash">; overrides?: Partial<Article> }): Article {
	const hash = hashOf(params.source);
	return {
		url: URL, metadata: METADATA, estimatedReadTime: 1,
		freshness: { ...params.freshness, canonicalContentHash: hash },
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "S", sourceContentHash: hash }, summaryAutoHeal: { attempts: 0 },
		readerAvailableAt: T0,
		contentSelection: { revision: 4, candidateId: params.source.metadata.id, tier: "tier-1", contentLocation: locationOf(params.source.metadata.id) },
		...params.overrides,
	};
}

const atT0 = (overrides: Partial<Article> = {}) => committedTo({ source: C0, freshness: { contentFetchedAt: T0, etag: "E0", bodyHash: "H0" }, overrides });
const atT2 = (overrides: Partial<Article> = {}) => committedTo({ source: C2, freshness: { contentFetchedAt: T2, etag: "E2", bodyHash: "H2" }, overrides });

const message = {
	t1: { source: C1, saveAttemptId: A1, refresh: { contentFetchedAt: T1, etag: "E1", bodyHash: "H1" } },
	t2: { source: C2, saveAttemptId: A2, refresh: { contentFetchedAt: T2, etag: "E2", bodyHash: "H2" } },
};
type Message = typeof message.t1;

function setup(params: { seed: Article; loadable: readonly VerifiedTierSource[]; onCanonicalWrite?: (store: ReturnType<typeof initInMemoryArticleStore>) => void; recordCrawlVersion?: RecordCrawlVersion }) {
	const store = initInMemoryArticleStore();
	store.seed(params.seed);
	const entries = new Map<string, TierSource>(params.loadable.map((source) => [`${source.tier}:${source.metadata.id}`, source]));
	const readTierSource: ReadTierSource = async ({ tier, candidateId }) => candidateId === undefined ? undefined : entries.get(`${tier}:${candidateId}`);
	let judgeCalls = 0;
	const newestReadsBest: SelectMostCompleteContent = async ({ candidates }) => {
		judgeCalls += 1;
		const [winner] = [...candidates].sort((left, right) => right.id.localeCompare(left.id));
		if (winner === undefined) throw new Error("the judge was sent no candidates");
		return {
			kind: "winner", candidateId: winner.id, reason: "the newest body reads best",
			readability: candidates.map((sent) => ({ candidateId: sent.id, readable: true })),
			audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: "completed" },
		};
	};
	const versionCalls: Parameters<RecordCrawlVersion>[0][] = [];
	const recordCrawlVersion: RecordCrawlVersion = async (call) => {
		versionCalls.push(call);
		await params.recordCrawlVersion?.(call);
	};
	const effects: Effect[] = [];
	const infoLines: [string, unknown][] = [];
	let canonicalWrites = 0;
	const writeCanonicalContent: WriteCanonicalContent = async ({ source }) => {
		canonicalWrites += 1;
		if (canonicalWrites === 1) params.onCanonicalWrite?.(store);
		return { contentLocation: locationOf(source.metadata.id), candidateId: source.metadata.id, tier: source.tier };
	};
	const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect: async (effect) => { effects.push(effect); }, logCrawlSettled: () => {} });
	const work = initSelectContentWork({
		...initListAvailableTierSources({ readTierSource }), selectMostCompleteContent: newestReadsBest,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), logger: noopLogger, now: () => NOW }),
		writeCanonicalContent, recordCrawlVersion, loadArticle: store.load, readCanonicalContent: async () => undefined, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined, putTierSource: async (put) => put.metadata,
		now: () => NOW, logger: { ...noopLogger, info: (...args: unknown[]) => { infoLines.push([String(args[0]), args[1]]); } },
	});
	const candidatesOf = (sent: Message) => [{ id: sent.source.metadata.id, tier: sent.source.tier }];
	return {
		deliver: (sent: Message) => work({ url: URL, saveAttemptId: sent.saveAttemptId, candidates: candidatesOf(sent), extractedAt: sent.refresh.contentFetchedAt, refresh: sent.refresh, mode: "refresh", claimId: `claim-${sent.saveAttemptId}`, remainingTimeMs: () => 300_000 }),
		deliverAs: (mode: "save" | "recrawl", sent: Message) => work({ url: URL, saveAttemptId: sent.saveAttemptId, candidates: candidatesOf(sent), extractedAt: sent.refresh.contentFetchedAt, mode, claimId: `claim-${mode}`, remainingTimeMs: () => 300_000 }),
		row: () => store.load(URL),
		judgeCalls: () => judgeCalls,
		refusedLines: () => infoLines.filter(([line]) => line === REFUSED),
		store, versionCalls, effects,
	};
}

const refusedLine = (params: { reason: string; sent: Message; rowFetchedAt: string }) => [REFUSED, { url: URL, saveAttemptId: params.sent.saveAttemptId, reason: params.reason, rowFetchedAt: params.rowFetchedAt, extractedAt: params.sent.refresh.contentFetchedAt }];
const freshnessOf = (sent: Message) => ({ ...sent.refresh, canonicalContentHash: hashOf(sent.source) });

describe("a refresh-content-extracted message yields to a row that moved on", () => {
	it("refuses a message older than a later commit, without judging, writing or dispatching", async () => {
		const seed = atT2();
		const harness = setup({ seed, loadable: [C1, C2] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.judgeCalls()).toBe(0);
		expect(harness.effects).toEqual([]);
		expect(harness.versionCalls).toEqual([]);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "row-newer", sent: message.t1, rowFetchedAt: T2 })]);
	});

	it("keeps the later canonical when the older message's candidate is a direct resource of its own attempt", async () => {
		const seed = atT2();
		const harness = setup({ seed, loadable: [C1_DIRECT, C2] });

		await harness.deliver({ ...message.t1, source: C1_DIRECT });

		const row = await harness.row();
		expect(row?.contentSelection).toEqual(seed.contentSelection);
		expect(row?.freshness.canonicalContentHash).toBe(hashOf(C2));
		expect(harness.judgeCalls()).toBe(0);
	});

	it.each([
		{ order: "newer first, then older", deliveries: [message.t2, message.t1] },
		{ order: "older first, then newer", deliveries: [message.t1, message.t2] },
	])("ends on the newer fetch whichever order two dead letters are redriven in ($order)", async ({ deliveries }) => {
		const harness = setup({ seed: atT0(), loadable: [C0, C1, C2] });

		for (const sent of deliveries) await harness.deliver(sent);

		const row = await harness.row();
		expect(row?.freshness).toEqual(freshnessOf(message.t2));
		expect(row?.contentSelection?.candidateId).toBe(C2.metadata.id);
	});

	it("commits the same message twice, advancing the revision on each and regenerating the summary once", async () => {
		const seed = atT0();
		const harness = setup({ seed, loadable: [C0, C1] });

		await harness.deliver(message.t1);
		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual({
			...seed,
			metadata: C1.metadata,
			freshness: freshnessOf(message.t1),
			summary: { kind: "pending", pendingSince: NOW.toISOString() },
			contentSelection: { revision: 6, candidateId: C1.metadata.id, tier: "tier-1", contentLocation: locationOf(C1.metadata.id) },
		});
		expect(harness.versionCalls).toEqual([
			expect.objectContaining({ crawledAt: T1, canonicalCommit: expect.objectContaining({ candidateId: C1.metadata.id }) }),
			expect.objectContaining({ crawledAt: T1, canonicalCommit: expect.objectContaining({ candidateId: C1.metadata.id }) }),
		]);
		expect(harness.effects).toEqual([{ kind: "publish-canonical-content-changed", url: URL }]);
		expect(harness.refusedLines()).toEqual([]);
	});

	it("lets a retry at an equal clock heal a crawl version the first run failed to record", async () => {
		let versionAttempts = 0;
		const harness = setup({
			seed: atT0(), loadable: [C0, C1],
			recordCrawlVersion: async () => {
				versionAttempts += 1;
				if (versionAttempts === 1) throw new Error("version log unavailable");
			},
		});

		await expect(harness.deliver(message.t1)).rejects.toThrow("version log unavailable");
		await harness.deliver(message.t1);

		const row = await harness.row();
		expect(row?.freshness).toEqual(freshnessOf(message.t1));
		expect(row?.contentSelection?.revision).toBe(6);
		expect(harness.versionCalls).toEqual([
			expect.objectContaining({ crawledAt: T1 }),
			expect.objectContaining({ crawledAt: T1 }),
		]);
		expect(harness.refusedLines()).toEqual([]);
	});

	it("reloads the row when a newer commit lands between load and commit, then refuses within the same delivery", async () => {
		const harness = setup({ seed: atT0(), loadable: [C0, C1], onCanonicalWrite: (racing) => racing.seed(atT2({ contentSelection: { revision: 5, candidateId: C2.metadata.id, tier: "tier-1", contentLocation: locationOf(C2.metadata.id) } })) });

		await harness.deliver(message.t1);

		const row = await harness.row();
		expect(row?.freshness).toEqual(freshnessOf(message.t2));
		expect(row?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "row-newer", sent: message.t1, rowFetchedAt: T2 })]);
	});

	it("refuses a message whose fetch a clock-only stamp has since passed", async () => {
		const seed = atT0({ freshness: { contentFetchedAt: STAMP_AFTER_T1, etag: "E0", bodyHash: "H0", canonicalContentHash: hashOf(C0) } });
		const harness = setup({ seed, loadable: [C0, C1] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.judgeCalls()).toBe(0);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "row-newer", sent: message.t1, rowFetchedAt: STAMP_AFTER_T1 })]);
	});

	it("refuses a purged row even while an orphan canonical candidate is still readable", async () => {
		const seed = atT0({ purgedAt: T2, freshness: { contentFetchedAt: "" }, summary: { kind: "skipped" } });
		const harness = setup({ seed, loadable: [C0, C1] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.judgeCalls()).toBe(0);
		expect(harness.effects).toEqual([]);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "purged", sent: message.t1, rowFetchedAt: "" })]);
	});

	it("refuses on a revived row whose save is newer than the message, leaving its crawl pending", async () => {
		const seed: Article = {
			url: URL, metadata: METADATA, estimatedReadTime: 1, freshness: { contentFetchedAt: "" }, savedAt: T2,
			crawl: { kind: "pending", pendingSince: T2 }, summary: { kind: "pending", pendingSince: T2 }, summaryAutoHeal: { attempts: 0 },
			contentSelection: { revision: 7 },
		};
		const harness = setup({ seed, loadable: [] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "row-newer", sent: message.t1, rowFetchedAt: "" })]);
	});

	it("refuses an unsupported row even when its clock is older than the message", async () => {
		const seed = atT0({ crawl: { kind: "unsupported", reason: { kind: "paywall" } } });
		const harness = setup({ seed, loadable: [C0, C1] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "unsupported", sent: message.t1, rowFetchedAt: T0 })]);
	});

	it("leaves a failed row failed when its clock is newer than the message", async () => {
		const seed = atT2({ crawl: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } } });
		const harness = setup({ seed, loadable: [C1, C2] });

		await harness.deliver(message.t1);

		expect(await harness.row()).toEqual(seed);
		expect(harness.refusedLines()).toEqual([refusedLine({ reason: "row-newer", sent: message.t1, rowFetchedAt: T2 })]);
	});

	it("heals a failed row whose clock is older than the message", async () => {
		const harness = setup({ seed: atT0({ crawl: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } }, readerAvailableAt: undefined }), loadable: [C0, C1] });

		await harness.deliver(message.t1);

		const row = await harness.row();
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.freshness).toEqual(freshnessOf(message.t1));
		expect(row?.readerAvailableAt).toBe(NOW.toISOString());
	});

	it.each([
		{ name: "a ready row whose clock is years older", seed: atT0({ freshness: { contentFetchedAt: "2020-01-01T00:00:00.000Z", etag: "E0", bodyHash: "H0", canonicalContentHash: hashOf(C0) } }), crawl: { kind: "ready" } },
		{ name: "a pending row whose clock is older", seed: atT0({ crawl: { kind: "pending", pendingSince: T2 } }), crawl: { kind: "pending", pendingSince: T2 } },
		{ name: "a row whose clock a failed recrawl left at the epoch", seed: atT0({ freshness: { contentFetchedAt: EPOCH, etag: "E0", bodyHash: "H0", canonicalContentHash: hashOf(C0) } }), crawl: { kind: "ready" } },
		{ name: "a row with no clock and no save time", seed: atT0({ freshness: { contentFetchedAt: "", canonicalContentHash: hashOf(C0) } }), crawl: { kind: "ready" } },
	])("commits the message on $name", async ({ seed, crawl }) => {
		const harness = setup({ seed, loadable: [C0, C1] });

		await harness.deliver(message.t1);

		const row = await harness.row();
		expect(row?.crawl).toEqual(crawl);
		expect(row?.freshness).toEqual(freshnessOf(message.t1));
		expect(row?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(harness.refusedLines()).toEqual([]);
	});

	it.each(["save", "recrawl"] as const)("never refuses in %s mode, even when the row's clock is newer than the extraction", async (mode) => {
		const harness = setup({ seed: atT2(), loadable: [C1, C2] });

		await harness.deliverAs(mode, message.t1);

		expect((await harness.row())?.contentSelection?.revision).toBe(5);
		expect(harness.refusedLines()).toEqual([]);
	});
});
