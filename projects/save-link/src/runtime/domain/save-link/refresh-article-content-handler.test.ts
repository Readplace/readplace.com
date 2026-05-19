import { noopLogger } from "@packages/hutch-logger";
import type { ReadRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";
import type { Context, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
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

const URL = "https://example.com/article";
const HTML = "<html><body><h1>Refreshed</h1></body></html>";
const DETAIL: RefreshDetail = {
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
};

describe("initRefreshArticleContentHandler (S3 read + tier-write + publish)", () => {
	it("reads the staged HTML from S3 and writes it as a tier-1 source so the selector can compare it against an existing tier-0", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), stubContext, () => {});

		expect(readRefreshHtml).toHaveBeenCalledWith(URL);
		expect(putTierSource).toHaveBeenCalledWith({
			url: URL,
			tier: "tier-1",
			html: HTML,
			metadata: expect.objectContaining({
				title: "New title",
				siteName: "Example",
				excerpt: "New excerpt",
				wordCount: 250,
				estimatedReadTime: 2,
			}),
		});
	});

	it("publishes RefreshContentExtractedEvent carrying url + freshness so the downstream selector handler can persist", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), stubContext, () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		const call = publishEvent.mock.calls[0][0];
		expect(call.source).toBe("hutch.save-link");
		expect(call.detailType).toBe("RefreshContentExtracted");
		expect(JSON.parse(call.detail)).toEqual({
			url: URL,
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		});
	});

	it("reads S3, writes the tier source, then publishes — in that order, so a fast downstream handler doesn't race a missing tier-1 read", async () => {
		const order: string[] = [];
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockImplementation(async () => {
			order.push("readRefreshHtml");
			return HTML;
		});
		const putTierSource: PutTierSource = jest.fn().mockImplementation(async () => {
			order.push("putTierSource");
		});
		const publishEvent = jest.fn().mockImplementation(async () => {
			order.push("publishEvent");
		});

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), stubContext, () => {});

		expect(order).toEqual(["readRefreshHtml", "putTierSource", "publishEvent"]);
	});

	it("reports the record as a batch failure on invalid event detail (zod failure) without touching S3 or tier source or event bus", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn();
		const putTierSource: PutTierSource = jest.fn();
		const publishEvent = jest.fn();

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
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
		expect(readRefreshHtml).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports a batch failure and does not publish when readRefreshHtml throws (stale message with no staged S3 object)", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest
			.fn()
			.mockRejectedValue(new Error("S3 NoSuchKey"));
		const putTierSource: PutTierSource = jest.fn();
		const publishEvent = jest.fn();

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), stubContext, () => {});

		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("does not publish when putTierSource throws so the downstream handler doesn't run with no tier-1 to read", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest
			.fn()
			.mockRejectedValue(new Error("s3 throttled"));
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), stubContext, () => {});

		expect(publishEvent).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
