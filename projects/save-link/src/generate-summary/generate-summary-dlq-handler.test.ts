import { noopLogger } from "@packages/hutch-logger";
import {
	markSummaryExhausted,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initGenerateSummaryDlqHandler } from "./generate-summary-dlq-handler";
import type { SQSEvent, SQSRecord, SQSRecordAttributes, Context } from "aws-lambda";

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

function createRecord(detail: unknown, receiveCount: number, messageId = "msg-1"): SQSRecord {
	return {
		messageId,
		receiptHandle: `receipt-${messageId}`,
		body: JSON.stringify({ detail }),
		attributes: attributes(receiveCount),
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:GenerateGlobalSummary-dlq",
		awsRegion: "ap-southeast-2",
	};
}

function createSqsEvent(detail: { url: string }, receiveCount = 3): SQSEvent {
	return { Records: [createRecord(detail, receiveCount)] };
}

describe("initGenerateSummaryDlqHandler", () => {
	it("dispatches markSummaryExhausted with the URL, reason, and receiveCount from the DLQ record", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined) as unknown as TransitionAndPersist;

		const handler = initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: "https://example.com/failed" }, 4), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markSummaryExhausted, {
			url: "https://example.com/failed",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 4 },
				receiveCount: 4,
			},
		});
	});

	it("returns an empty batchItemFailures when there are no records", async () => {
		const transitionAndPersist = jest.fn() as unknown as TransitionAndPersist;

		const handler = initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler({ Records: [] }, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure on invalid command envelope (Zod failure)", async () => {
		const transitionAndPersist = jest.fn() as unknown as TransitionAndPersist;

		const handler = initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = { Records: [createRecord({ invalid: true }, 3)] };

		const result = await handler(invalidEvent, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when the transition throws (SQS redelivers; canary catches the stuck row)", async () => {
		const transitionAndPersist = jest
			.fn()
			.mockRejectedValue(new Error("ddb throttled")) as unknown as TransitionAndPersist;

		const handler = initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/failed" }, 4),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("isolates per-record failures: only the failing record ends up in batchItemFailures", async () => {
		const transitionAndPersist = jest
			.fn()
			.mockImplementation(async (_transition: unknown, params: { url: string }) => {
				if (params.url === "https://example.com/explode") {
					throw new Error("downstream blew up");
				}
			}) as unknown as TransitionAndPersist;

		const handler = initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const event: SQSEvent = {
			Records: [
				createRecord({ url: "https://example.com/ok" }, 4, "msg-ok"),
				createRecord({ url: "https://example.com/explode" }, 4, "msg-bad"),
			],
		};

		const result = await handler(event, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-bad" }] });
		expect(transitionAndPersist).toHaveBeenCalledTimes(2);
	});
});
