import type {
	Article,
	ArticleStore,
	Effect,
} from "@packages/domain/article-aggregate";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/hutch-logger";
import {
	initInMemoryArticleStore,
	initInMemoryEffectDispatcher,
} from "@packages/test-fixtures/providers/article-aggregate";
import type { Context, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initRefreshArticleContentHandler } from "./refresh-article-content-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

const stubContext: Context = {
	callbackWaitsForEmptyEventLoop: true,
	functionName: "test",
	functionVersion: "1",
	invokedFunctionArn: "arn:aws:lambda:ap-southeast-2:123456789:function:test",
	memoryLimitInMB: "128",
	awsRequestId: "test-request-id",
	logGroupName: "/aws/lambda/test",
	logStreamName: "test-stream",
	getRemainingTimeInMillis: () => 30000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
};

interface RefreshDetail {
	url: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		imageUrl?: string;
	};
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
}

function createSqsEvent(detail: RefreshDetail): SQSEvent {
	return {
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
				awsRegion: "ap-southeast-2",
			},
		],
	};
}

function seededArticle(url: string): Article {
	return {
		url,
		metadata: {
			title: "Old title",
			siteName: "Example",
			excerpt: "Old excerpt",
			wordCount: 100,
		},
		freshness: {
			etag: '"old-etag"',
			contentFetchedAt: "2026-01-01T00:00:00.000Z",
		},
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: {
			kind: "ready",
			summary: "stale summary",
			excerpt: "stale summary excerpt",
		},
	};
}

describe("initRefreshArticleContentHandler (aggregate-driven)", () => {
	it("flips summary back to pending and dispatches generate-summary in that order", async () => {
		// Why this matters: the previous (pre-aggregate) handler used a single
		// inline UpdateExpression to clear summary text + reset summaryStatus,
		// then issued GenerateSummaryCommand. A change to one limb without the
		// other left rows stuck on "Generating summary…" — the
		// fagnerbrack.com/why-developers-become-frustrated-… regression on
		// 2026-05-10. The aggregate folds both into a single transition: if a
		// future writer drops the dispatch, this test (and the transition's own
		// test) fails before the change reaches production.
		const URL = "https://example.com/article";
		const articleStore = initInMemoryArticleStore();
		articleStore.seed(seededArticle(URL));
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();
		const { transitionAndPersist } = initTransitionAndPersist({
			store: articleStore,
			dispatchEffect,
		});

		const handler = initRefreshArticleContentHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({
				url: URL,
				metadata: {
					title: "New title",
					siteName: "Example",
					excerpt: "New excerpt",
					wordCount: 250,
				},
				estimatedReadTime: 2,
				etag: '"new-etag"',
				lastModified: "Sun, 10 May 2026 12:00:00 GMT",
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			}),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });

		const updated = await articleStore.load(URL);
		expect(updated?.metadata.title).toBe("New title");
		expect(updated?.metadata.wordCount).toBe(250);
		expect(updated?.freshness.etag).toBe('"new-etag"');
		expect(updated?.freshness.contentFetchedAt).toBe("2026-05-10T12:00:00.000Z");
		expect(updated?.estimatedReadTime).toBe(2);
		expect(updated?.summary).toEqual({ kind: "pending" });
		expect(dispatched).toEqual<Effect[]>([
			{ kind: "generate-summary", url: URL },
		]);
	});

	it("dispatches AFTER the store records summary=pending so the worker never reads a status=ready cache hit", async () => {
		// Why this matters: summarizeArticle short-circuits when the cached
		// summaryStatus is "ready" (link-summariser.ts:52). If the dispatcher
		// fired before the row's summaryStatus flipped to pending, a fast worker
		// could read the stale "ready" cache and return before regenerating.
		// The orchestrator save→dispatch order locks this in by construction.
		const URL = "https://example.com/article";
		const order: string[] = [];
		const articleStore = initInMemoryArticleStore();
		articleStore.seed(seededArticle(URL));

		const wrappedStore: ArticleStore = {
			load: articleStore.load,
			save: async (params) => {
				order.push(`save:${params.article.summary.kind}`);
				await articleStore.save(params);
			},
		};
		const { dispatchEffect: realDispatch } = initInMemoryEffectDispatcher();
		const dispatchEffect = async (effect: Effect) => {
			order.push(`dispatch:${effect.kind}`);
			await realDispatch(effect);
		};
		const { transitionAndPersist } = initTransitionAndPersist({
			store: wrappedStore,
			dispatchEffect,
		});

		const handler = initRefreshArticleContentHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({
				url: URL,
				metadata: { title: "x", siteName: "x", excerpt: "x", wordCount: 1 },
				estimatedReadTime: 1,
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			}),
			stubContext,
			() => {},
		);

		expect(order).toEqual(["save:pending", "dispatch:generate-summary"]);
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure) without touching the store", async () => {
		const articleStore = initInMemoryArticleStore();
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();
		const { transitionAndPersist } = initTransitionAndPersist({
			store: articleStore,
			dispatchEffect,
		});

		const handler = initRefreshArticleContentHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { invalid: true } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(invalidEvent, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(dispatched).toEqual([]);
	});

	it("does not dispatch when the store throws on save", async () => {
		// Why this matters: dispatching a regen command for a row whose new
		// state never persisted would summarise stale content; SQS retry must
		// replay the whole transition once the store is healthy again.
		const URL = "https://example.com/article";
		const articleStore = initInMemoryArticleStore();
		articleStore.seed(seededArticle(URL));
		const failingStore = {
			load: articleStore.load,
			save: async () => {
				throw new Error("ddb throttled");
			},
		};
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();
		const { transitionAndPersist } = initTransitionAndPersist({
			store: failingStore,
			dispatchEffect,
		});

		const handler = initRefreshArticleContentHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({
				url: URL,
				metadata: { title: "x", siteName: "x", excerpt: "x", wordCount: 1 },
				estimatedReadTime: 1,
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			}),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(dispatched).toEqual([]);
	});

	it("reports the record as a batch failure when no aggregate exists for the URL (assertion in orchestrator)", async () => {
		// The aggregate orchestrator asserts the row exists before transitioning;
		// a missing row is a programmer/data error and SQS retry will eventually
		// surface as a DLQ alarm rather than silently upsert an inconsistent row.
		const articleStore = initInMemoryArticleStore();
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();
		const { transitionAndPersist } = initTransitionAndPersist({
			store: articleStore,
			dispatchEffect,
		});

		const handler = initRefreshArticleContentHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({
				url: "https://example.com/never-saved",
				metadata: { title: "x", siteName: "x", excerpt: "x", wordCount: 1 },
				estimatedReadTime: 1,
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			}),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(dispatched).toEqual([]);
	});
});
