import assert from "node:assert/strict";
import { noopLogger } from "@packages/logger";
import { CandidateIdSchema } from "@packages/domain/article";
import {
	type Article,
	type DispatchEffect,
	CanonicalImageUrlSchema,
	CanonicalPublishedOnSchema,
	initTransitionAndPersist,
	isCanonicalCandidateRevoked,
	markCrawlFailed,
	promoteTier,
	recrawlPromoteTier,
} from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { Handler, SQSBatchResponse, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initGenerateSummaryHandler } from "../generate-summary/generate-summary-handler";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";
import type { SummarizeArticle } from "../generate-summary/link-summariser";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import type { FindArticleContent } from "./article-content.types";
import { initCanonicalContentChangedHandler } from "./canonical-content-changed-handler";

const URL = "https://example.com/article";
const FIXED_NOW = new Date("2026-05-31T10:00:00.000Z");
const BODY_A = "<article><p>The first canonical body of the article.</p></article>";
const BODY_B = "<article><p>The second, newer canonical body of the article.</p></article>";
const HASH_A = computeCanonicalContentHash(BODY_A);
const HASH_B = computeCanonicalContentHash(BODY_B);
const CANDIDATE_A = CandidateIdSchema.parse("candidate-a");
const CANDIDATE_B = CandidateIdSchema.parse("candidate-b");
const LOCATION_A = "s3://content/a.html";
const LOCATION_B = "s3://content/b.html";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function sqsEvent(detail: Record<string, unknown>): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:canonical-content-changed",
			awsRegion: "ap-southeast-2",
		}],
	};
}

function buildArticle(overrides: Partial<Article>): Article {
	return {
		url: URL,
		metadata: { title: "Title", siteName: "example.com", excerpt: "x", wordCount: 500 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z", canonicalContentHash: HASH_A },
		estimatedReadTime: 3,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: "2026-05-30T10:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		contentSelection: { revision: 1, candidateId: CANDIDATE_A, contentLocation: LOCATION_A, tier: "tier-1" },
		...overrides,
	};
}

const revivedRow = buildArticle({
	crawl: { kind: "pending", pendingSince: "2026-05-30T10:00:00.000Z" },
	freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
	contentSelection: { revision: 1 },
});

function setup(seed: Article) {
	const store = initInMemoryArticleStore();
	store.seed(seed);
	const bodies = new Map<string, string>([[LOCATION_A, BODY_A], [LOCATION_B, BODY_B]]);
	const findArticleContent: FindArticleContent = async (url) => {
		const row = await store.load(url);
		if (row === undefined || row.purgedAt !== undefined || isCanonicalCandidateRevoked(row.contentSelection)) return undefined;
		const location = row.contentSelection?.contentLocation;
		const content = location === undefined ? undefined : bodies.get(location);
		return content === undefined ? undefined : { content };
	};
	const summarizeArticle = jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>(async ({ textContent }) => ({
		kind: "ready",
		summary: `Summary of ${computeCanonicalContentHash(textContent)}`,
		excerpt: "Excerpt.",
		inputTokens: 100,
		outputTokens: 40,
		cacheHitInputTokens: 64,
		cacheMissInputTokens: 36,
	}));

	let generateSummaryHandler: Handler<SQSEvent, SQSBatchResponse>;
	let canonicalContentChangedHandler: Handler<SQSEvent, SQSBatchResponse>;
	const dispatchEffect: DispatchEffect = async (effect) => {
		if (effect.kind === "publish-canonical-content-changed") {
			await canonicalContentChangedHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
		} else if (effect.kind === "generate-summary") {
			await generateSummaryHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
		}
	};
	const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect, logCrawlSettled: () => {} });
	generateSummaryHandler = initGenerateSummaryHandler({
		summarizeArticle,
		runMeteredLeg: initRunMeteredLeg({
			...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => FIXED_NOW }),
			logger: noopLogger,
			now: () => FIXED_NOW,
		}),
		findArticleContent,
		loadArticle: store.load,
		transitionAndPersist,
		now: () => FIXED_NOW,
		logger: noopLogger,
		deepseekCallFailedLog: noopLogger,
	});
	canonicalContentChangedHandler = initCanonicalContentChangedHandler({
		loadArticle: store.load,
		findArticleContent,
		dispatchGenerateSummary: async (command) => {
			await generateSummaryHandler(sqsEvent(command), buildLambdaContext(), () => {});
		},
		logger: noopLogger,
	});
	const redrive = () => canonicalContentChangedHandler(sqsEvent({ url: URL }), buildLambdaContext(), () => {});
	return { store, summarizeArticle, transitionAndPersist, redrive };
}

const commitMetadata = {
	title: "Title",
	siteName: "example.com",
	excerpt: "x",
	wordCount: 500,
	imageUrl: CanonicalImageUrlSchema.parse(undefined),
	publishedOn: CanonicalPublishedOnSchema.parse(undefined),
};

describe("canonical-content-changed redrive", () => {
	it("regenerates a pending row once when the message is delivered twice", async () => {
		const { store, summarizeArticle, redrive } = setup(buildArticle({}));

		await redrive();
		await redrive();

		assert.deepEqual((await store.load(URL))?.summary, { kind: "ready", summary: `Summary of ${HASH_A}`, excerpt: "Excerpt.", inputTokens: 100, outputTokens: 40, sourceContentHash: HASH_A });
		assert.equal(summarizeArticle.mock.calls.length, 1);
	});

	it("leaves a ready row unchanged when the message is delivered twice", async () => {
		const seed = buildArticle({ summary: { kind: "ready", summary: "Kept.", sourceContentHash: HASH_A } });
		const { store, summarizeArticle, redrive } = setup(seed);

		await redrive();
		await redrive();

		assert.deepEqual(await store.load(URL), seed);
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("heals a failed summary on redrive", async () => {
		const { store, summarizeArticle, redrive } = setup(buildArticle({ summary: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } } }));

		await redrive();

		assert.equal((await store.load(URL))?.summary.kind, "ready");
		assert.equal(summarizeArticle.mock.calls.length, 1);
	});

	it("heals a ready summary generated from another canonical body on redrive", async () => {
		const { store, summarizeArticle, redrive } = setup(buildArticle({ summary: { kind: "ready", summary: "Stale.", sourceContentHash: "old-hash" } }));

		await redrive();

		assert.deepEqual((await store.load(URL))?.summary, { kind: "ready", summary: `Summary of ${HASH_A}`, excerpt: "Excerpt.", inputTokens: 100, outputTokens: 40, sourceContentHash: HASH_A });
		assert.equal(summarizeArticle.mock.calls.length, 1);
	});

	it("collapses a crawl-failed row with no content to skipped(crawl-failed) on redrive", async () => {
		const { store, summarizeArticle, redrive } = setup(buildArticle({
			crawl: { kind: "failed", reason: { kind: "not-found", httpStatus: 404 } },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			contentSelection: undefined,
		}));

		const result = await redrive();

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual((await store.load(URL))?.summary, { kind: "skipped", reason: "crawl-failed" });
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("keeps a removal's skipped(crawl-failed) row on a revoked candidate and fails the record", async () => {
		const seed = buildArticle({
			crawl: { kind: "failed", reason: { kind: "not-found", httpStatus: 404 } },
			summary: { kind: "skipped", reason: "crawl-failed" },
			contentSelection: { revision: 2, candidateId: CANDIDATE_A, contentLocation: LOCATION_A, revokedCandidateIds: [CANDIDATE_A] },
		});
		const { store, summarizeArticle, redrive } = setup(seed);

		const result = await redrive();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(await store.load(URL), seed);
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("keeps a newer commit's ready summary when an older message arrives after it", async () => {
		const seed = buildArticle({
			freshness: { contentFetchedAt: "2026-02-01T00:00:00.000Z", canonicalContentHash: HASH_B },
			summary: { kind: "ready", summary: "Summary of B.", sourceContentHash: HASH_B },
			contentSelection: { revision: 2, candidateId: CANDIDATE_B, contentLocation: LOCATION_B, tier: "tier-1" },
		});
		const { store, summarizeArticle, redrive } = setup(seed);

		await redrive();

		assert.deepEqual(await store.load(URL), seed);
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("consumes a message that arrives after the URL was purged", async () => {
		const seed = buildArticle({
			purgedAt: "2026-06-01T00:00:00.000Z",
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			summary: { kind: "skipped", reason: "content-purged" },
			contentSelection: undefined,
		});
		const { store, summarizeArticle, redrive } = setup(seed);

		const result = await redrive();

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual((await store.load(URL))?.summary, { kind: "skipped", reason: "content-purged" });
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("keeps a message for a revived row until the crawl commits, and then settles it", async () => {
		const { store, summarizeArticle, transitionAndPersist, redrive } = setup(revivedRow);

		const first = await redrive();

		assert.deepEqual(first, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.equal(summarizeArticle.mock.calls.length, 0);
		assert.deepEqual(store.savedCalls, []);

		await transitionAndPersist(promoteTier, {
			url: URL,
			input: {
				tier: "tier-1",
				display: { kind: "candidate" },
				metadata: commitMetadata,
				estimatedReadTime: 3,
				contentFetchedAt: "2026-06-02T00:00:00.000Z",
				now: "2026-06-02T00:00:00.000Z",
				canonicalChanged: true,
				canonicalContentHash: HASH_B,
			},
			canonicalCommit: { expected: revivedRow.contentSelection, contentLocation: LOCATION_B, candidateId: CANDIDATE_B, originalUrl: URL, tier: "tier-1" },
		});

		assert.equal((await store.load(URL))?.summary.kind, "ready");
		assert.equal(summarizeArticle.mock.calls.length, 1);

		const redriven = await redrive();

		assert.deepEqual(redriven, { batchItemFailures: [] });
		assert.equal(summarizeArticle.mock.calls.length, 1);
	});

	it("collapses a revived row whose crawl ended through markCrawlFailed once the kept message is redriven", async () => {
		const { store, summarizeArticle, transitionAndPersist, redrive } = setup(revivedRow);

		const first = await redrive();
		await transitionAndPersist(markCrawlFailed, { url: URL, input: { reason: { kind: "not-found", httpStatus: 404 } } });

		assert.deepEqual(first, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.equal((await store.load(URL))?.summary.kind, "pending");

		const redriven = await redrive();

		assert.deepEqual(redriven, { batchItemFailures: [] });
		assert.deepEqual((await store.load(URL))?.summary, { kind: "skipped", reason: "crawl-failed" });
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("keeps a skipped(declined) summary when the message arrives after the decline", async () => {
		const seed = buildArticle({ summary: { kind: "skipped", reason: "declined" } });
		const { store, summarizeArticle, redrive } = setup(seed);

		await redrive();

		assert.deepEqual(await store.load(URL), seed);
		assert.equal(summarizeArticle.mock.calls.length, 0);
	});

	it("still regenerates when an operator recrawl promotes the same canonical hash", async () => {
		const { store, summarizeArticle, transitionAndPersist, redrive } = setup(buildArticle({}));
		await redrive();

		await transitionAndPersist(recrawlPromoteTier, {
			url: URL,
			input: {
				winnerTier: "tier-1",
				metadata: commitMetadata,
				estimatedReadTime: 3,
				contentFetchedAt: "2026-06-03T00:00:00.000Z",
				now: "2026-06-03T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		assert.deepEqual((await store.load(URL))?.summary, { kind: "ready", summary: `Summary of ${HASH_A}`, excerpt: "Excerpt.", inputTokens: 100, outputTokens: 40, sourceContentHash: HASH_A });
		assert.equal(summarizeArticle.mock.calls.length, 2);
	});
});
