import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import type { ParseErrorEvent } from "@packages/hutch-infra-components";
import { initSummaryGenerationFailedHandler } from "./summary-generation-failed-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
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
		const parseErrorLogger: HutchLogger.Typed<ParseErrorEvent> = {
			info: infoSpy,
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};
		const now = () => new Date("2026-04-19T12:00:00.000Z");

		const handler = initSummaryGenerationFailedHandler({ parseErrorLogger, logger: noopLogger, now });

		await handler(
			createSqsEvent({
				url: "https://example.com/article",
				reason: "deepseek timeout",
				receiveCount: 3,
			}),
			buildLambdaContext(),
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

	it("appends receiveCount exactly once for the exhausted-retries reason (no doubled (receiveCount=N))", async () => {
		const infoSpy = jest.fn();
		const parseErrorLogger: HutchLogger.Typed<ParseErrorEvent> = {
			info: infoSpy,
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};
		const now = () => new Date("2026-04-19T12:00:00.000Z");

		const handler = initSummaryGenerationFailedHandler({ parseErrorLogger, logger: noopLogger, now });

		await handler(
			createSqsEvent({
				url: "https://example.com/article",
				reason: "exhausted-retries",
				receiveCount: 4,
			}),
			buildLambdaContext(),
			() => {},
		);

		expect(infoSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				reason: "summary-generation-failed: exhausted-retries (receiveCount=4)",
			}),
		);
	});

	it("reports invalid envelopes as a batch failure without logging the parse-error stream", async () => {
		const infoSpy = jest.fn();
		const parseErrorLogger: HutchLogger.Typed<ParseErrorEvent> = {
			info: infoSpy,
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};
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

		const result = await handler(invalid, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(infoSpy).not.toHaveBeenCalled();
	});
});
