import { noopLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initSaveLinkRawHtmlDlqHandler } from "./save-link-raw-html-dlq-handler";
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
	it("dispatches the markCrawlExhausted transition with the URL, reason, and receiveCount from the DLQ record", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = initSaveLinkRawHtmlDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/failed", userId: "user-1" }, 4),
			stubContext,
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/failed",
			input: {
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			},
		});
	});

	it("reports the record as a batch failure on invalid command envelope (Zod failure) and does NOT dispatch the transition", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn();

		const handler = initSaveLinkRawHtmlDlqHandler({
			transitionAndPersist,
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
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when the transition throws (SQS redelivers; canary catches the stuck row)", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockRejectedValue(new Error("ddb throttled"));

		const handler = initSaveLinkRawHtmlDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/failed", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
