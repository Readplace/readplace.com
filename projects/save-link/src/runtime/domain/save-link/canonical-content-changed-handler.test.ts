import assert from "node:assert/strict";
import { noopLogger } from "@packages/logger";
import type { Article } from "@packages/domain/article-aggregate";
import { CandidateIdSchema } from "@packages/domain/article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initCanonicalContentChangedHandler } from "./canonical-content-changed-handler";
import type { FindArticleContent } from "./article-content.types";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const URL = "https://example.com/article";
const candidateId = CandidateIdSchema.parse("candidate-1");

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: Record<string, unknown>): SQSEvent {
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
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z", canonicalContentHash: "hash-current" },
		estimatedReadTime: 3,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: "2026-05-31T10:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		contentSelection: { candidateId, contentLocation: "s3://content/current.html", tier: "tier-1" },
		...overrides,
	};
}

function setup(params: { seed?: Article; content: string | undefined }) {
	const store = initInMemoryArticleStore();
	if (params.seed) store.seed(params.seed);
	const dispatches: { url: string }[] = [];
	const contentReads: string[] = [];
	const findArticleContent: FindArticleContent = async (url) => {
		contentReads.push(url);
		return params.content === undefined ? undefined : { content: params.content };
	};
	const handler = initCanonicalContentChangedHandler({
		loadArticle: store.load,
		findArticleContent,
		dispatchGenerateSummary: async (command) => {
			dispatches.push(command);
		},
		logger: noopLogger,
	});
	const run = (detail: Record<string, unknown> = { url: URL }) => handler(createSqsEvent(detail), buildLambdaContext(), () => {});
	return { store, dispatches, contentReads, run };
}

describe("initCanonicalContentChangedHandler", () => {
	it("dispatches for a pending summary with readable content and leaves the row untouched", async () => {
		const { store, dispatches, run } = setup({ seed: buildArticle({}), content: "<p>Body</p>" });

		const result = await run();

		assert.deepEqual(dispatches, [{ url: URL }]);
		assert.deepEqual(store.savedCalls, []);
		assert.deepEqual(result, { batchItemFailures: [] });
	});

	it("dispatches for a pending summary while the crawl is pending but content is readable", async () => {
		const { dispatches, run } = setup({
			seed: buildArticle({ crawl: { kind: "pending", pendingSince: "2026-05-31T10:00:00.000Z" } }),
			content: "<p>Body</p>",
		});

		await run();

		assert.deepEqual(dispatches, [{ url: URL }]);
	});

	it("keeps a ready summary that matches the canonical and dispatches nothing", async () => {
		const seed = buildArticle({ summary: { kind: "ready", summary: "S", sourceContentHash: "hash-current" } });
		const { store, dispatches, run } = setup({ seed, content: "<p>Body</p>" });

		const result = await run();

		assert.deepEqual(dispatches, []);
		assert.deepEqual(await store.load(URL), seed);
		assert.deepEqual(result, { batchItemFailures: [] });
	});

	it("keeps a skipped declined summary and dispatches nothing", async () => {
		const seed = buildArticle({ summary: { kind: "skipped", reason: "declined" } });
		const { store, dispatches, run } = setup({ seed, content: "<p>Body</p>" });

		const result = await run();

		assert.deepEqual(dispatches, []);
		assert.deepEqual(await store.load(URL), seed);
		assert.deepEqual(result, { batchItemFailures: [] });
	});

	it("treats a tombstoned URL as a clean no-op without reading content", async () => {
		const seed = buildArticle({
			purgedAt: "2026-06-01T00:00:00.000Z",
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			summary: { kind: "skipped", reason: "content-purged" },
			contentSelection: undefined,
		});
		const { dispatches, contentReads, run } = setup({ seed, content: undefined });

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(dispatches, []);
		assert.deepEqual(contentReads, []);
	});

	it("does not treat a settled summary on a revoked candidate as settled, and fails the record while the crawl is ready", async () => {
		const { store, dispatches, run } = setup({
			seed: buildArticle({
				summary: { kind: "ready", summary: "S", sourceContentHash: "hash-current" },
				contentSelection: { candidateId, contentLocation: "s3://content/current.html", revokedCandidateIds: [candidateId] },
			}),
			content: undefined,
		});

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(store.savedCalls, []);
		assert.deepEqual(dispatches, []);
	});

	it("fails the record when the crawl is pending and no content is readable, and dispatches nothing", async () => {
		const { store, dispatches, run } = setup({
			seed: buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-31T10:00:00.000Z" },
				freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
				contentSelection: undefined,
			}),
			content: undefined,
		});

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(store.savedCalls, []);
		assert.deepEqual(dispatches, []);
	});

	it.each([
		{ crawl: { kind: "failed", reason: { kind: "not-found", httpStatus: 404 } } },
		{ crawl: { kind: "unsupported", reason: { kind: "paywall" } } },
	] satisfies { crawl: Article["crawl"] }[])("dispatches for an ended crawl ($crawl.kind) with no readable content", async ({ crawl }) => {
		const { dispatches, run } = setup({ seed: buildArticle({ crawl }), content: undefined });

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(dispatches, [{ url: URL }]);
	});

	it.each([
		{ crawl: { kind: "failed", reason: { kind: "not-found", httpStatus: 404 } } },
		{ crawl: { kind: "unsupported", reason: { kind: "paywall" } } },
	] satisfies { crawl: Article["crawl"] }[])("fails the record for a revoked candidate while the crawl is $crawl.kind, and dispatches nothing", async ({ crawl }) => {
		const { store, dispatches, run } = setup({
			seed: buildArticle({
				crawl,
				summary: { kind: "skipped", reason: "crawl-failed" },
				contentSelection: { candidateId, revokedCandidateIds: [candidateId] },
			}),
			content: undefined,
		});

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(store.savedCalls, []);
		assert.deepEqual(dispatches, []);
	});

	it("fails the record when the crawl is ready and no content is readable", async () => {
		const { store, run } = setup({ seed: buildArticle({}), content: undefined });

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(store.savedCalls, []);
	});

	it("fails the record when the article row is absent", async () => {
		const { dispatches, run } = setup({ content: "<p>Body</p>" });

		const result = await run();

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(dispatches, []);
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const { dispatches, run } = setup({ seed: buildArticle({}), content: "<p>Body</p>" });

		const result = await run({ invalid: true });

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(dispatches, []);
	});
});
