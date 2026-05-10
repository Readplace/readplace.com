import { noopLogger } from "@packages/hutch-logger";
import { initRefreshArticleContentHandler } from "./refresh-article-content-handler";
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

function createSqsEvent(detail: {
	url: string;
	metadata: { title: string; siteName: string; excerpt: string; wordCount: number; imageUrl?: string };
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
}): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initRefreshArticleContentHandler", () => {
	it("calls refreshArticleContent with parsed detail", async () => {
		const refreshArticleContent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			refreshArticleContent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			etag: '"abc"',
			lastModified: "Thu, 10 Apr 2026 12:00:00 GMT",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		}), stubContext, () => {});

		expect(refreshArticleContent).toHaveBeenCalledTimes(1);
		expect(refreshArticleContent).toHaveBeenCalledWith({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			etag: '"abc"',
			lastModified: "Thu, 10 Apr 2026 12:00:00 GMT",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		});
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const handler = initRefreshArticleContentHandler({
			refreshArticleContent: jest.fn(),
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
