import assert from "node:assert/strict";
import { CandidateIdSchema, SaveAttemptIdSchema, type CandidateId, type SaveAttemptId } from "@packages/domain/article";
import { type Article, type Effect, SelectionSnapshotChangedError, initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { noopLogger } from "@packages/logger";
import { candidateProvenance, type TierSource, type VerifiedTierSource } from "@packages/tier-source";
import { initSelectContentWorkUnderLease } from "./select-content-work";
import { ContentJudgeInFlightError } from "./judge-under-ledger";
import { initListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { ReadTierSource, WriteCanonicalContent } from "./tier-source-access.types";
import type { RecordCrawlVersion } from "./crawl-versions";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-03T00:00:00.000Z";
const A1 = SaveAttemptIdSchema.parse("attempt-1");
const A2 = SaveAttemptIdSchema.parse("attempt-2");
const METADATA = { title: "Article", siteName: "example.com", excerpt: "", wordCount: 50, estimatedReadTime: 1 };
const RECOVERED = "[SelectContent] recovered a changed selection snapshot";
const WAITED = "[SelectContent] decided after waiting for another delivery's content judge";
const STOPPED_WAITING = "[SelectContent] stopped waiting for another delivery's content judge";
const LAMBDA_BUDGET_MS = 300_000;

function candidate(params: { id: string; attemptId: SaveAttemptId; fetchedAt: string }): VerifiedTierSource {
	const html = `<article><p>The body ${params.id} fetched at ${params.fetchedAt}.</p></article>`;
	return {
		tier: "tier-1", html,
		metadata: {
			...candidateProvenance({ metadata: METADATA, html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: params.fetchedAt, httpStatus: 200 }),
			id: CandidateIdSchema.parse(params.id),
		},
	};
}

const C1 = candidate({ id: "c1", attemptId: A1, fetchedAt: T1 });
const C2 = candidate({ id: "c2", attemptId: A2, fetchedAt: T2 });
const locationOf = (id: CandidateId) => `s3://content/${id}.html`;

function pendingFirstSave(overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: METADATA, estimatedReadTime: 1, freshness: { contentFetchedAt: T1 },
		crawl: { kind: "pending", pendingSince: T1 }, summary: { kind: "pending", pendingSince: T1 }, summaryAutoHeal: { attempts: 0 }, ...overrides,
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve };
}

function setup(params: {
	seed: Article;
	beforeCanonicalWrite?: (write: { call: number; store: ReturnType<typeof initInMemoryArticleStore> }) => Promise<void> | void;
	dispatchEffect?: (effect: Effect) => Promise<void>;
	recordCrawlVersion?: RecordCrawlVersion;
	beforeJudge?: (judged: readonly string[]) => Promise<void>;
	onClaimRefused?: () => void;
	holderWait?: { delayMs: number; maxWaits: number; sleep: () => Promise<void> };
}) {
	const store = initInMemoryArticleStore();
	store.seed(params.seed);
	const entries = new Map<string, TierSource>([C1, C2].map((source) => [`${source.tier}:${source.metadata.id}`, source]));
	const readTierSource: ReadTierSource = async ({ tier, candidateId }) => candidateId === undefined ? undefined : entries.get(`${tier}:${candidateId}`);
	const judged: string[][] = [];
	const newestReadsBest: SelectMostCompleteContent = async ({ candidates }) => {
		judged.push(candidates.map((sent) => sent.id).sort());
		await params.beforeJudge?.(candidates.map((sent) => sent.id));
		const [winner] = [...candidates].sort((left, right) => right.id.localeCompare(left.id));
		assert(winner, "the judge was sent candidates");
		return {
			kind: "winner", candidateId: winner.id, reason: "the newest body reads best",
			readability: candidates.map((sent) => ({ candidateId: sent.id, readable: true })),
			audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: "completed" },
		};
	};
	const effects: Effect[] = [];
	const infoLines: [string, unknown][] = [];
	const canonicalWrites: CandidateId[] = [];
	const writeCanonicalContent: WriteCanonicalContent = async ({ source }) => {
		canonicalWrites.push(source.metadata.id);
		await params.beforeCanonicalWrite?.({ call: canonicalWrites.length, store });
		return { contentLocation: locationOf(source.metadata.id), candidateId: source.metadata.id, tier: source.tier };
	};
	const versionCalls: Parameters<RecordCrawlVersion>[0][] = [];
	const { transitionAndPersist } = initTransitionAndPersist({
		store,
		dispatchEffect: async (effect) => { await params.dispatchEffect?.(effect); effects.push(effect); },
		logCrawlSettled: () => {},
	});
	const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
	const work = initSelectContentWorkUnderLease({
		...initListAvailableTierSources({ readTierSource }), selectMostCompleteContent: newestReadsBest,
		runMeteredLeg: initRunMeteredLeg({
			...ledger,
			claimMeteredLeg: async (claim) => {
				const claimed = await ledger.claimMeteredLeg(claim);
				if (claimed.kind === "in-flight") params.onClaimRefused?.();
				return claimed;
			},
			logger: noopLogger, now: () => NOW,
		}),
		writeCanonicalContent,
		recordCrawlVersion: async (call) => { await params.recordCrawlVersion?.(call); versionCalls.push(call); },
		loadArticle: store.load, readCanonicalContent: async () => undefined, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined, putTierSource: async (put) => put.metadata,
		now: () => NOW, logger: { ...noopLogger, info: (...args: unknown[]) => { infoLines.push([String(args[0]), args[1]]); } },
	}, { judgeClaimTtlMs: LAMBDA_BUDGET_MS, heldClaim: "wait-for-holder", holderWait: params.holderWait ?? { delayMs: 1, maxWaits: 15, sleep: async () => {} } });
	return {
		save: (params: { source: VerifiedTierSource; claimId: string; remainingTimeMs?: () => number }) => work({
			url: URL, saveAttemptId: SaveAttemptIdSchema.parse(params.source.metadata.attemptId), candidates: [{ id: params.source.metadata.id, tier: params.source.tier }],
			mode: "save", claimId: params.claimId, remainingTimeMs: params.remainingTimeMs ?? (() => LAMBDA_BUDGET_MS),
		}),
		row: () => store.load(URL),
		recovered: () => infoLines.filter(([line]) => line === RECOVERED).map(([, fields]) => fields),
		logged: (message: string) => infoLines.filter(([line]) => line === message).map(([, fields]) => fields),
		judged, effects, canonicalWrites, versionCalls,
	};
}

const committedC2 = (revision: number): Partial<Article> => ({ contentSelection: { revision, candidateId: C2.metadata.id, tier: "tier-1", contentLocation: locationOf(C2.metadata.id) } });

describe("a selection whose snapshot changed before its commit", () => {
	it("re-prepares the loser of two selections gated after the same snapshot and keeps the winner's canonical", async () => {
		const releases: (() => void)[] = [];
		const arrived = [deferred(), deferred()];
		const harness = setup({
			seed: pendingFirstSave(),
			beforeCanonicalWrite: async ({ call }) => {
				if (call > 2) return;
				const gate = deferred();
				releases.push(gate.resolve);
				arrived[call - 1]?.resolve();
				await gate.promise;
			},
		});

		const loser = harness.save({ source: C1, claimId: "message-1" });
		await arrived[0]?.promise;
		const winner = harness.save({ source: C2, claimId: "message-2" });
		await arrived[1]?.promise;
		releases[1]?.();
		await winner;
		releases[0]?.();
		await loser;

		const row = await harness.row();
		expect(row?.contentSelection).toEqual(expect.objectContaining({ revision: 2, candidateId: C2.metadata.id, contentLocation: locationOf(C2.metadata.id) }));
		expect(row?.crawl.kind).toBe("ready");
		expect(row?.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(C2.html));
		expect(harness.versionCalls).toHaveLength(1);
		expect(harness.judged).toEqual([["c1"], ["c2"], ["c1", "c2"]]);
		expect(harness.canonicalWrites).toEqual([C1.metadata.id, C2.metadata.id, C2.metadata.id]);
		expect(harness.effects).toEqual(EFFECTS_AFTER_RACE);
		expect(harness.recovered()).toEqual([{ url: URL, saveAttemptId: A1, conflicts: ["selection-changed"], attempts: 2 }]);
	});

	it("reuses the settled verdict when the reloaded candidates match, even with too little time left for a fresh judge call", async () => {
		const harness = setup({
			seed: pendingFirstSave({ ...committedC2(3) }),
			beforeCanonicalWrite: ({ call, store }) => { if (call === 1) store.seed(pendingFirstSave(committedC2(4))); },
		});

		await harness.save({ source: C1, claimId: "message-1", remainingTimeMs: () => 60_000 });

		expect(harness.judged).toEqual([["c1", "c2"]]);
		expect((await harness.row())?.contentSelection?.revision).toBe(5);
		expect(harness.recovered()).toEqual([{ url: URL, saveAttemptId: A1, conflicts: ["selection-changed"], attempts: 2 }]);
	});

	it("never commits a candidate revoked after preparation and keeps the canonical in place", async () => {
		const harness = setup({
			seed: pendingFirstSave({ ...committedC2(3) }),
			beforeCanonicalWrite: ({ call, store }) => {
				if (call === 1) store.seed(pendingFirstSave({ contentSelection: { revision: 4, candidateId: C2.metadata.id, tier: "tier-1", contentLocation: locationOf(C2.metadata.id), revokedCandidateIds: [C2.metadata.id] } }));
			},
		});

		await harness.save({ source: C1, claimId: "message-1" });

		const row = await harness.row();
		expect(row?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(row?.contentSelection?.revision).toBe(5);
		expect(harness.judged).toEqual([["c1", "c2"], ["c1"]]);
		expect(harness.recovered()).toEqual([{ url: URL, saveAttemptId: A1, conflicts: ["candidate-revoked"], attempts: 2 }]);
	});

	it("leaves a row tombstoned between preparation and commit untouched and marks nothing failed", async () => {
		const tombstoned = pendingFirstSave({ purgedAt: T2 });
		const harness = setup({ seed: pendingFirstSave(), beforeCanonicalWrite: ({ store }) => { store.seed(tombstoned); } });

		await harness.save({ source: C1, claimId: "message-1" });

		expect(await harness.row()).toEqual(tombstoned);
		expect(harness.recovered()).toEqual([]);
	});

	it("stops after three decision attempts against a row that keeps changing, leaving the newest state", async () => {
		const harness = setup({
			seed: pendingFirstSave(),
			beforeCanonicalWrite: ({ call, store }) => { store.seed(pendingFirstSave(committedC2(10 + call))); },
		});

		const refused = await harness.save({ source: C1, claimId: "message-1" }).catch((error: unknown) => error);

		assert(refused instanceof SelectionSnapshotChangedError, "the last conflict escapes to the queue");
		expect(refused.conflict).toBe("selection-changed");
		expect(harness.canonicalWrites).toHaveLength(3);
		expect(harness.judged).toEqual([["c1"], ["c1", "c2"]]);
		expect((await harness.row())?.contentSelection?.revision).toBe(13);
		expect(harness.effects).toEqual([]);
		expect(harness.recovered()).toEqual([]);
	});

	it("refuses a fresh judge call on a retry when the provider deadline and commit reserve no longer fit", async () => {
		let remainingMs = LAMBDA_BUDGET_MS;
		const harness = setup({
			seed: pendingFirstSave(),
			beforeCanonicalWrite: ({ call, store }) => { if (call === 1) { store.seed(pendingFirstSave(committedC2(1))); remainingMs = 240_000 + 5_000 - 1; } },
		});

		await expect(harness.save({ source: C1, claimId: "message-1", remainingTimeMs: () => remainingMs })).rejects.toThrow("a fresh content judge call needs 245000 ms");

		expect(harness.judged).toEqual([["c1"]]);
		expect(harness.canonicalWrites).toHaveLength(1);
		expect(harness.effects).toEqual([]);
	});

	it("lets the conflict escape without a retry when less than the commit reserve is left", async () => {
		const harness = setup({
			seed: pendingFirstSave(),
			beforeCanonicalWrite: ({ store }) => { store.seed(pendingFirstSave(committedC2(1))); },
		});

		await expect(harness.save({ source: C1, claimId: "message-1", remainingTimeMs: () => 5_000 })).rejects.toBeInstanceOf(SelectionSnapshotChangedError);

		expect(harness.canonicalWrites).toHaveLength(1);
	});

	it.each([
		{ name: "an effect dispatch", dispatchEffect: async () => { throw new Error("effect dispatch failed"); } },
		{ name: "a crawl version record", recordCrawlVersion: async () => { throw new Error("version log unavailable"); } },
	])("treats $name failing after the commit as that failure, not a pre-commit conflict", async (failing) => {
		const harness = setup({ seed: pendingFirstSave(), ...failing });

		await expect(harness.save({ source: C1, claimId: "message-1" })).rejects.toThrow(/effect dispatch failed|version log unavailable/);

		expect(harness.canonicalWrites).toEqual([C1.metadata.id]);
		expect(harness.judged).toEqual([["c1"]]);
		expect((await harness.row())?.contentSelection).toEqual(expect.objectContaining({ revision: 1, candidateId: C1.metadata.id }));
		expect(harness.recovered()).toEqual([]);
	});
});

describe("a selection that finds another delivery holding the content judge", () => {
	function heldJudge(params: { delayMs: number; maxWaits: number; waitEndsWhenHolderCommits: boolean; onClaimRefused?: (release: () => void) => void }) {
		const holderEntered = deferred();
		const holderRelease = deferred();
		const holderCommitted = deferred();
		const harness = setup({
			seed: pendingFirstSave(),
			holderWait: { delayMs: params.delayMs, maxWaits: params.maxWaits, sleep: params.waitEndsWhenHolderCommits ? () => holderCommitted.promise : async () => {} },
			beforeJudge: async (candidateIds) => {
				if (candidateIds.join() !== "c2") return;
				holderEntered.resolve();
				await holderRelease.promise;
			},
			onClaimRefused: () => params.onClaimRefused?.(holderRelease.resolve),
		});
		const holder = harness.save({ source: C2, claimId: "message-2" }).finally(holderCommitted.resolve);
		return { harness, holder, holderEntered: holderEntered.promise, releaseHolder: holderRelease.resolve };
	}

	it("waits for the holder to commit, then decides against the holder's canonical in the same delivery", async () => {
		const { harness, holder, holderEntered } = heldJudge({ delayMs: 1_000, maxWaits: 15, waitEndsWhenHolderCommits: true, onClaimRefused: (release) => release() });
		await holderEntered;

		await harness.save({ source: C1, claimId: "message-1" });
		await holder;

		const row = await harness.row();
		expect(row?.crawl.kind).toBe("ready");
		expect(row?.contentSelection).toEqual(expect.objectContaining({ candidateId: C2.metadata.id }));
		expect(harness.judged).toEqual([["c2"], ["c1", "c2"]]);
		expect(harness.logged(WAITED)).toEqual([{ url: URL, saveAttemptId: A1, holderWaits: 1 }]);
		expect(harness.logged(STOPPED_WAITING)).toEqual([]);
	});

	it("fails the delivery as before once its waits run out, without a judge call of its own", async () => {
		const { harness, holder, holderEntered, releaseHolder } = heldJudge({ delayMs: 1_000, maxWaits: 2, waitEndsWhenHolderCommits: false });
		await holderEntered;

		const refused = await harness.save({ source: C1, claimId: "message-1" }).catch((error: unknown) => error);
		releaseHolder();
		await holder;

		assert(refused instanceof ContentJudgeInFlightError, "the held claim escapes to the queue");
		expect(harness.judged).toEqual([["c2"]]);
		expect(harness.logged(STOPPED_WAITING)).toEqual([{ url: URL, saveAttemptId: A1, holderWaits: 2 }]);
		expect(harness.logged(WAITED)).toEqual([]);
	});

	it("does not wait when a fresh judge call would no longer fit after the wait", async () => {
		const { harness, holder, holderEntered, releaseHolder } = heldJudge({ delayMs: 1_000, maxWaits: 15, waitEndsWhenHolderCommits: false });
		await holderEntered;

		const refused = await harness.save({ source: C1, claimId: "message-1", remainingTimeMs: () => 240_000 + 5_000 + 1_000 - 1 }).catch((error: unknown) => error);
		releaseHolder();
		await holder;

		assert(refused instanceof ContentJudgeInFlightError, "the held claim escapes to the queue");
		expect(harness.logged(STOPPED_WAITING)).toEqual([{ url: URL, saveAttemptId: A1, holderWaits: 0 }]);
	});

	it("refuses a fresh judge call after the wait when the provider deadline and commit reserve no longer fit", async () => {
		const { harness, holder, holderEntered } = heldJudge({ delayMs: 1_000, maxWaits: 15, waitEndsWhenHolderCommits: true, onClaimRefused: (release) => release() });
		await holderEntered;
		const remaining = [LAMBDA_BUDGET_MS, 240_000 + 5_000 - 1];

		await expect(harness.save({ source: C1, claimId: "message-1", remainingTimeMs: () => remaining.shift() ?? 0 }))
			.rejects.toThrow("waits for another delivery's judge: 1); a fresh content judge call needs 245000 ms");
		await holder;

		expect(harness.judged).toEqual([["c2"]]);
	});
});

const EFFECTS_AFTER_RACE: Effect[] = [
	{ kind: "publish-canonical-content-changed", url: URL },
	{ kind: "publish-crawl-article-completed", url: URL },
	{ kind: "publish-crawl-article-completed", url: URL },
];
