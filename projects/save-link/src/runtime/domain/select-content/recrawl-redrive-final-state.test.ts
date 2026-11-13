import { CandidateIdSchema, SaveAttemptIdSchema, type CandidateId } from "@packages/domain/article";
import { type Article, type DispatchEffect, initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger } from "@packages/logger";
import { candidateProvenance, type TierSource, type VerifiedTierSource } from "@packages/tier-source";
import type { SQSEvent } from "aws-lambda";
import { initRecrawlContentExtractedHandler } from "./recrawl-content-extracted-handler";
import { initListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { ReadTierSource, WriteCanonicalContent } from "./tier-source-access.types";
import type { RecordCrawlVersion } from "./crawl-versions";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-22T00:00:00.000Z");
const T0 = "2026-10-19T00:00:00.000Z";
const C1_FETCHED = "2026-10-20T00:00:00.000Z";
const C2_FETCHED = "2026-10-21T00:00:00.000Z";
const ORIGINAL_FETCHED = "2026-10-21T00:00:05.000Z";
const EXTRACTED_AT = "2026-10-20T00:00:00.000Z";
const M1_ATTEMPT = SaveAttemptIdSchema.parse("m1-attempt");
const C2_ATTEMPT = SaveAttemptIdSchema.parse("c2-attempt");
const METADATA = { title: "Article", siteName: "example.com", excerpt: "", wordCount: 50, estimatedReadTime: 1 };

function candidate(params: { id: string; attemptId: typeof M1_ATTEMPT; fetchedAt: string }): VerifiedTierSource {
	const html = `<article><p>The body ${params.id} fetched at ${params.fetchedAt}.</p></article>`;
	return {
		tier: "tier-1", html,
		metadata: { ...candidateProvenance({
			metadata: METADATA, html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL,
			kind: "live", fetchedAt: params.fetchedAt, httpStatus: 200,
		}), id: CandidateIdSchema.parse(params.id) },
	};
}

const C1 = candidate({ id: "c1", attemptId: M1_ATTEMPT, fetchedAt: C1_FETCHED });
const C2 = candidate({ id: "c2", attemptId: C2_ATTEMPT, fetchedAt: C2_FETCHED });
const C1_HASH = computeCanonicalContentHash(C1.html);
const C2_HASH = computeCanonicalContentHash(C2.html);
const locationOf = (id: CandidateId) => `s3://content/${id}.html`;

function committedToC2(overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: METADATA, estimatedReadTime: 1,
		freshness: { contentFetchedAt: ORIGINAL_FETCHED, etag: "E2", canonicalContentHash: C2_HASH },
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "S2", sourceContentHash: C2_HASH }, summaryAutoHeal: { attempts: 0 },
		contentSelection: { revision: 2, candidateId: C2.metadata.id, tier: "tier-1", contentLocation: locationOf(C2.metadata.id) },
		...overrides,
	};
}

function neverCommitted(overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: METADATA, estimatedReadTime: 1, freshness: { contentFetchedAt: T0 },
		crawl: { kind: "pending", pendingSince: T0 }, summary: { kind: "pending", pendingSince: T0 }, summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function m1(messageId: string): SQSEvent {
	return {
		Records: [{
			messageId, receiptHandle: `receipt-${messageId}`,
			body: JSON.stringify({ detail: { url: URL, saveAttemptId: M1_ATTEMPT, candidates: [{ id: C1.metadata.id, tier: "tier-1" }], extractedAt: EXTRACTED_AT } }),
			attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1620000000000", SenderId: "TESTID", ApproximateFirstReceiveTimestamp: "1620000000001" },
			messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:recrawl-content-extracted", awsRegion: "ap-southeast-2",
		}],
	};
}

function setup(params: { seed: Article; loadable: readonly VerifiedTierSource[]; onCanonicalWrite?: (store: ReturnType<typeof initInMemoryArticleStore>) => void }) {
	const store = initInMemoryArticleStore();
	store.seed(params.seed);
	const entries = new Map<string, TierSource>(params.loadable.map((source) => [`${source.tier}:${source.metadata.id}`, source]));
	const readTierSource = jest.fn<ReturnType<ReadTierSource>, Parameters<ReadTierSource>>(async ({ tier, candidateId }) => candidateId === undefined
		? [...entries.values()].filter((source) => source.tier === tier).at(-1)
		: entries.get(`${tier}:${candidateId}`));
	const judge = jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>(async ({ candidates }) => ({
		kind: "winner", candidateId: C1.metadata.id, reason: "C1 reads best",
		readability: candidates.map((sent) => ({ candidateId: sent.id, readable: true })),
		audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: "completed" },
	}));
	const recordCrawlVersion = jest.fn<ReturnType<RecordCrawlVersion>, Parameters<RecordCrawlVersion>>(async () => {});
	const dispatchEffect = jest.fn<ReturnType<DispatchEffect>, Parameters<DispatchEffect>>(async () => {});
	let canonicalWrites = 0;
	const writeCanonicalContent: WriteCanonicalContent = async ({ source }) => {
		canonicalWrites += 1;
		if (canonicalWrites === 1) params.onCanonicalWrite?.(store);
		return { contentLocation: locationOf(source.metadata.id), candidateId: source.metadata.id, tier: source.tier };
	};
	const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect, logCrawlSettled: () => {} });
	const handler = initRecrawlContentExtractedHandler({
		...initListAvailableTierSources({ readTierSource }), selectMostCompleteContent: judge,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), logger: noopLogger, now: () => NOW }),
		writeCanonicalContent, recordCrawlVersion, loadArticle: store.load, readCanonicalContent: async () => undefined, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined, putTierSource: async (put) => put.metadata,
		now: () => NOW, logger: noopLogger, deepseekCallFailedLog: noopLogger,
	});
	return {
		deliver: (messageId: string) => handler(m1(messageId), buildLambdaContext(), () => {}),
		store, judge, recordCrawlVersion, dispatchEffect, readTierSource,
	};
}

describe("redriving a recrawl-content-extracted dead letter", () => {
	it("keeps a later commit's canonical, validators and summary when the redrive's candidate was fetched before it", async () => {
		const { deliver, store, judge, recordCrawlVersion, dispatchEffect } = setup({ seed: committedToC2(), loadable: [C1, C2] });

		expect(await deliver("redrive-1")).toEqual({ batchItemFailures: [] });

		const row = await store.load(URL);
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.contentSelection).toMatchObject({ candidateId: C2.metadata.id, contentLocation: locationOf(C2.metadata.id) });
		expect(row?.freshness).toEqual({ contentFetchedAt: ORIGINAL_FETCHED, etag: "E2", canonicalContentHash: C2_HASH });
		expect(row?.summary).toEqual({ kind: "ready", summary: "S2", sourceContentHash: C2_HASH });
		expect(recordCrawlVersion).toHaveBeenCalledTimes(0);
		expect(judge).toHaveBeenCalledTimes(0);
		expect(dispatchEffect.mock.calls.map(([effect]) => effect)).toEqual([{ kind: "publish-recrawl-completed", url: URL }]);
	});

	it("commits on the first pass and retains on the second, replaying the settled verdict, when the same message is delivered twice", async () => {
		const { deliver, store, judge, recordCrawlVersion, dispatchEffect } = setup({ seed: neverCommitted(), loadable: [C1] });

		expect(await deliver("redrive-1")).toEqual({ batchItemFailures: [] });
		expect(await deliver("redrive-2")).toEqual({ batchItemFailures: [] });

		const row = await store.load(URL);
		expect(judge).toHaveBeenCalledTimes(1);
		expect(recordCrawlVersion).toHaveBeenCalledTimes(2);
		expect(recordCrawlVersion.mock.calls.map(([call]) => call)).toEqual([
			expect.objectContaining({ crawledAt: EXTRACTED_AT, canonicalCommit: expect.objectContaining({ candidateId: C1.metadata.id }) }),
			expect.objectContaining({ crawledAt: EXTRACTED_AT, canonicalCommit: expect.objectContaining({ candidateId: C1.metadata.id }) }),
		]);
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(row?.freshness.canonicalContentHash).toBe(C1_HASH);
		expect(row?.summary).toEqual({ kind: "pending", pendingSince: T0 });
		expect(dispatchEffect.mock.calls.map(([effect]) => effect)).toEqual([
			{ kind: "publish-canonical-content-changed", url: URL },
			{ kind: "publish-recrawl-completed", url: URL },
			{ kind: "publish-recrawl-completed", url: URL },
		]);
	});

	it("heals a later recrawl's exhaustion by keeping the newer canonical and re-priming its crawl-failed summary", async () => {
		const { deliver, store, judge, dispatchEffect } = setup({
			seed: committedToC2({ crawl: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } }, summary: { kind: "failed", reason: { kind: "crawl-failed" } } }),
			loadable: [C1, C2],
		});

		expect(await deliver("redrive-1")).toEqual({ batchItemFailures: [] });

		const row = await store.load(URL);
		expect(judge).toHaveBeenCalledTimes(0);
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.summary).toEqual({ kind: "pending", pendingSince: NOW.toISOString() });
		expect(row?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(row?.freshness.canonicalContentHash).toBe(C2_HASH);
		expect(dispatchEffect.mock.calls.map(([effect]) => effect)).toEqual([
			{ kind: "generate-summary", url: URL },
			{ kind: "publish-recrawl-completed", url: URL },
		]);
	});

	it("commits the message's candidate on an exhausted row that never held a canonical", async () => {
		const { deliver, store, judge, dispatchEffect } = setup({
			seed: neverCommitted({ crawl: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } }, summary: { kind: "failed", reason: { kind: "crawl-failed" } } }),
			loadable: [C1],
		});

		expect(await deliver("redrive-1")).toEqual({ batchItemFailures: [] });

		const row = await store.load(URL);
		expect(judge).toHaveBeenCalledTimes(1);
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(row?.freshness.canonicalContentHash).toBe(C1_HASH);
		expect(dispatchEffect.mock.calls.map(([effect]) => effect)).toEqual([
			{ kind: "publish-canonical-content-changed", url: URL },
			{ kind: "publish-recrawl-completed", url: URL },
		]);
	});

	it("reloads the row when a newer commit lands between read and write, and keeps that newer canonical within the same delivery", async () => {
		const { deliver, store, readTierSource, judge, dispatchEffect } = setup({
			seed: neverCommitted(), loadable: [C1, C2],
			onCanonicalWrite: (racing) => racing.seed(committedToC2()),
		});

		expect(await deliver("delivery-1")).toEqual({ batchItemFailures: [] });

		const row = await store.load(URL);
		expect(readTierSource).toHaveBeenCalledWith({ url: URL, tier: "tier-1", candidateId: C2.metadata.id });
		expect(judge).toHaveBeenCalledTimes(1);
		expect(dispatchEffect.mock.calls.map(([effect]) => effect)).toEqual([{ kind: "publish-recrawl-completed", url: URL }]);
		expect(row?.crawl).toEqual({ kind: "ready" });
		expect(row?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(row?.freshness.canonicalContentHash).toBe(C2_HASH);
	});
});
