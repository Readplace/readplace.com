import { initSummaryGeneratedHandler } from "./summary-generated-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: { url: string; inputTokens: number; outputTokens: number }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:GlobalSummaryGenerated",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSummaryGeneratedHandler", () => {
	it("should log event data", async () => {
		const logger = {
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};

		const handler = initSummaryGeneratedHandler({ logger });

		await handler(createSqsEvent({
			url: "https://example.com/article",
			inputTokens: 150,
			outputTokens: 42,
		}), buildLambdaContext(), () => {});

		expect(logger.info).toHaveBeenCalledWith("[GlobalSummaryGenerated]", {
			url: "https://example.com/article",
			inputTokens: 150,
			outputTokens: 42,
		});
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const logger = {
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};

		const handler = initSummaryGeneratedHandler({ logger });

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:GlobalSummaryGenerated",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
