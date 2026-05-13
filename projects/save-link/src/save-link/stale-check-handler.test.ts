import type { LoadArticle, TransitionAndPersist } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/hutch-logger";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";
import { initStaleCheckHandler } from "./stale-check-handler";

const noopLoadArticle: LoadArticle = async () => undefined;
const noopTransitionAndPersist: TransitionAndPersist = async () => {};
const fixedNow = () => new Date("2026-05-13T12:00:00.000Z");

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

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const URL_UNDER_TEST = "https://example.com/article";

describe("initStaleCheckHandler", () => {
	it("re-publishes SaveAnonymousLinkCommand when refreshArticleIfStale returns 'new' (e.g. row was evicted between view and worker)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "new",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
		expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: URL_UNDER_TEST });
	});

	it("does not publish SaveAnonymousLinkCommand when refreshArticleIfStale returns 'skip' (within TTL)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "skip",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
	});

	it("does not publish SaveAnonymousLinkCommand when refreshArticleIfStale returns 'unchanged' (304)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "unchanged",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
	});

	it("does not publish SaveAnonymousLinkCommand when refreshArticleIfStale returns 'refreshed' (it already published RefreshArticleContent)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "refreshed",
			article: {
				ok: true,
				article: {
					title: "Test",
					siteName: "example.com",
					excerpt: "Excerpt",
					wordCount: 100,
					content: "<p>Body</p>",
				},
			},
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
	});

	it("processes every record in a batch", async () => {
		const refreshArticleIfStale = jest.fn<
			ReturnType<RefreshArticleIfStale>,
			Parameters<RefreshArticleIfStale>
		>().mockResolvedValue({ action: "new" });
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		const batch: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { url: "https://a.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
				{
					messageId: "msg-2",
					receiptHandle: "receipt-2",
					body: JSON.stringify({ detail: { url: "https://b.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(batch, stubContext, () => {});

		expect(refreshArticleIfStale).toHaveBeenCalledTimes(2);
		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(2);
		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(1, { url: "https://a.example.com/" });
		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(2, { url: "https://b.example.com/" });
		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("reports the failed record (and only that record) when refreshArticleIfStale throws mid-batch", async () => {
		const refreshArticleIfStale = jest
			.fn<ReturnType<RefreshArticleIfStale>, Parameters<RefreshArticleIfStale>>()
			.mockResolvedValueOnce({ action: "new" })
			.mockRejectedValueOnce(new Error("upstream failure"));
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		const batch: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { url: "https://a.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
				{
					messageId: "msg-2",
					receiptHandle: "receipt-2",
					body: JSON.stringify({ detail: { url: "https://b.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(batch, stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
		expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: "https://a.example.com/" });
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-2" }] });
	});

	it("reports the record as a batch failure when the event detail fails zod validation", async () => {
		const handler = initStaleCheckHandler({
			refreshArticleIfStale: jest.fn(),
			publishSaveAnonymousLink: jest.fn(),
			loadArticle: noopLoadArticle,
			transitionAndPersist: noopTransitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { wrong: "shape" } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reprimes a failed summary via incrementSummaryAutoHealAttempt when decideSummaryAutoHeal says 'reprime'", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "skip",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);
		const loadArticle: LoadArticle = async () => ({
			url: URL_UNDER_TEST,
			metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "ready" },
			summary: { kind: "failed", reason: { kind: "model-overload" } },
			summaryAutoHeal: { attempts: 0 },
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle,
			transitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({
				url: URL_UNDER_TEST,
				input: { now: fixedNow().toISOString() },
			}),
		);
	});

	it("does not call transitionAndPersist when the article is summary=ready (decideSummaryAutoHeal returns 'skip')", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "skip",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);
		const loadArticle: LoadArticle = async () => ({
			url: URL_UNDER_TEST,
			metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "ready" },
			summary: { kind: "ready", summary: "abc" },
			summaryAutoHeal: { attempts: 0 },
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle,
			transitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("does not call transitionAndPersist when loadArticle returns undefined (row not yet persisted)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "new",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);
		const loadArticle: LoadArticle = async () => undefined;
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			loadArticle,
			transitionAndPersist,
			now: fixedNow,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).not.toHaveBeenCalled();
	});
});
