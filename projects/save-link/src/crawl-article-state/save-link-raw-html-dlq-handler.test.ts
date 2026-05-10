import { noopLogger } from "@packages/hutch-logger";
import { initSaveLinkRawHtmlDlqHandler } from "./save-link-raw-html-dlq-handler";
import type { MarkCrawlFailed } from "./article-crawl.types";
import type { MarkSummaryFailed } from "../generate-summary/article-summary.types";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";

function attributes(receiveCount: number): SQSRecordAttributes {
	return {
		ApproximateReceiveCount: String(receiveCount),
		SentTimestamp: "1620000000000",
		SenderId: "TESTID",
		ApproximateFirstReceiveTimestamp: "1620000000001",
	};
}

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

function createSqsEvent(
	detail: { url: string; userId: string; title?: string },
	receiveCount = 3,
): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: attributes(receiveCount),
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:save-link-raw-html-command-dlq",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSaveLinkRawHtmlDlqHandler", () => {
	it("marks the crawl and summary as failed and publishes CrawlArticleFailedEvent when a message lands in DLQ", async () => {
		const markCrawlFailed: MarkCrawlFailed = jest.fn().mockResolvedValue(undefined);
		const markSummaryFailed: MarkSummaryFailed = jest.fn().mockResolvedValue(undefined);
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSaveLinkRawHtmlDlqHandler({
			markCrawlFailed,
			markSummaryFailed,
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/failed", userId: "user-1" }, 4),
			stubContext,
			() => {},
		);

		expect(markCrawlFailed).toHaveBeenCalledWith({
			url: "https://example.com/failed",
			reason: "exceeded SQS maxReceiveCount",
		});
		expect(markSummaryFailed).toHaveBeenCalledWith({
			url: "https://example.com/failed",
			reason: "crawl failed",
		});
		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "CrawlArticleFailed",
			detail: JSON.stringify({
				url: "https://example.com/failed",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			}),
		});
	});

	it("reports the record as a batch failure on invalid command envelope (Zod failure)", async () => {
		const markCrawlFailed: MarkCrawlFailed = jest.fn();
		const markSummaryFailed: MarkSummaryFailed = jest.fn();
		const publishEvent: PublishEvent = jest.fn();

		const handler = initSaveLinkRawHtmlDlqHandler({
			markCrawlFailed,
			markSummaryFailed,
			publishEvent,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: attributes(3),
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:save-link-raw-html-command-dlq",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(markCrawlFailed).not.toHaveBeenCalled();
		expect(markSummaryFailed).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});
});
