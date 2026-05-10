import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import type { ParseErrorEvent } from "@packages/hutch-infra-components";
import { initSummaryGenerationFailedHandler } from "./summary-generation-failed-handler";
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

function createSqsEvent(detail: { url: string; reason: string; receiveCount: number }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SummaryGenerationFailed",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSummaryGenerationFailedHandler", () => {
	it("logs a parse-error record with source=generate-summary", async () => {
		const infoSpy = jest.fn();
		const parseErrorLogger = { info: infoSpy } as unknown as HutchLogger.Typed<ParseErrorEvent>;
		const now = () => new Date("2026-04-19T12:00:00.000Z");

		const handler = initSummaryGenerationFailedHandler({ parseErrorLogger, logger: noopLogger, now });

		await handler(
			createSqsEvent({
				url: "https://example.com/article",
				reason: "deepseek timeout",
				receiveCount: 3,
			}),
			stubContext,
			() => {},
		);

		expect(infoSpy).toHaveBeenCalledWith({
			stream: "parse-errors",
			event: "parse-failure",
			timestamp: "2026-04-19T12:00:00.000Z",
			url: "https://example.com/article",
			reason: "summary-generation-failed: deepseek timeout (receiveCount=3)",
			source: "generate-summary",
		});
	});

	it("reports invalid envelopes as a batch failure without logging the parse-error stream", async () => {
		const infoSpy = jest.fn();
		const parseErrorLogger = { info: infoSpy } as unknown as HutchLogger.Typed<ParseErrorEvent>;
		const handler = initSummaryGenerationFailedHandler({
			parseErrorLogger,
			logger: noopLogger,
			now: () => new Date(),
		});

		const invalid: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SummaryGenerationFailed",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalid, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(infoSpy).not.toHaveBeenCalled();
	});
});
