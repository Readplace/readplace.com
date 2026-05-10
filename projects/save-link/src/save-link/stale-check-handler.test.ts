import { noopLogger } from "@packages/hutch-logger";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import { initStaleCheckHandler } from "./stale-check-handler";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";

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
	it("re-publishes SaveAnonymousLinkCommand when refreshArticleIfStale returns 'reprime'", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "reprime",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
		expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: URL_UNDER_TEST });
	});

	it("re-publishes SaveAnonymousLinkCommand when refreshArticleIfStale returns 'new' (e.g. row was evicted between view and worker)", async () => {
		const refreshArticleIfStale: RefreshArticleIfStale = async () => ({
			action: "new",
		});
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
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
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
	});

	it("processes every record in a batch", async () => {
		const refreshArticleIfStale = jest.fn<
			ReturnType<RefreshArticleIfStale>,
			Parameters<RefreshArticleIfStale>
		>().mockResolvedValue({ action: "reprime" });
		const publishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = initStaleCheckHandler({
			refreshArticleIfStale,
			publishSaveAnonymousLink,
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

		await handler(batch, stubContext, () => {});

		expect(refreshArticleIfStale).toHaveBeenCalledTimes(2);
		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(2);
		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(1, { url: "https://a.example.com/" });
		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(2, { url: "https://b.example.com/" });
	});

	it("throws on invalid event detail (zod parse failure)", async () => {
		const handler = initStaleCheckHandler({
			refreshArticleIfStale: jest.fn(),
			publishSaveAnonymousLink: jest.fn(),
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

		await expect(
			handler(invalidEvent, stubContext, () => {}),
		).rejects.toThrow();
	});
});
