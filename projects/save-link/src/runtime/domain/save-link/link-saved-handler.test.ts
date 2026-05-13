import { noopLogger } from "@packages/hutch-logger";
import { initLinkSavedHandler } from "./link-saved-handler";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";
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

function createSqsEvent(detail: { url: string; userId: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:LinkSaved",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initLinkSavedHandler", () => {
	it("dispatches GenerateSummaryCommand when article has content", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => ({ content: "<p>Some content</p>" });

		const handler = initLinkSavedHandler({
			dispatchGenerateSummary,
			findArticleContent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(dispatchGenerateSummary).toHaveBeenCalledWith({ url: "https://example.com/article" });
	});

	it("reports batchItemFailures when canonical content is not yet readable so SQS redelivers through maxReceiveCount", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => undefined;

		const handler = initLinkSavedHandler({
			dispatchGenerateSummary,
			findArticleContent,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/no-content", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => ({ content: "content" });

		const handler = initLinkSavedHandler({
			dispatchGenerateSummary,
			findArticleContent,
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:LinkSaved",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
