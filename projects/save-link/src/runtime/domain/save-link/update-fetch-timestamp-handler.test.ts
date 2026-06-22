import { noopLogger } from "@packages/hutch-logger";
import { initUpdateFetchTimestampHandler } from "./update-fetch-timestamp-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: { url: string; contentFetchedAt: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:UpdateFetchTimestamp",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initUpdateFetchTimestampHandler", () => {
	it("calls updateFetchTimestamp with parsed detail", async () => {
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);

		const handler = initUpdateFetchTimestampHandler({
			updateFetchTimestamp,
			logger: noopLogger,
		});

		await handler(createSqsEvent({
			url: "https://example.com/article",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		}), buildLambdaContext(), () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledTimes(1);
		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/article",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		});
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const handler = initUpdateFetchTimestampHandler({
			updateFetchTimestamp: jest.fn(),
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:UpdateFetchTimestamp",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
