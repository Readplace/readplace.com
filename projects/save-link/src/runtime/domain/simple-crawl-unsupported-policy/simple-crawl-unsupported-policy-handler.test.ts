import { noopLogger } from "@packages/hutch-logger";
import { ComprehensiveCrawlCommand } from "@packages/hutch-infra-components";
import { initSimpleCrawlUnsupportedPolicyHandler } from "./simple-crawl-unsupported-policy-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: {
	url: string;
	userId?: string;
	recrawl?: boolean;
	refresh?: boolean;
	previousBodyHash?: string;
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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSimpleCrawlUnsupportedPolicyHandler", () => {
	it("dispatches ComprehensiveCrawlCommand with url and userId from the SimpleCrawlUnsupportedEvent", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			userId: "user-1",
			recrawl: undefined,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("dispatches ComprehensiveCrawlCommand with recrawl=true when the event carries the recrawl flag", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", recrawl: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			userId: undefined,
			recrawl: true,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("dispatches ComprehensiveCrawlCommand with refresh=true when the event carries the refresh flag (stale-check chain)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", refresh: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			userId: undefined,
			recrawl: undefined,
			refresh: true,
			previousBodyHash: undefined,
		});
	});

	it("forwards previousBodyHash so the downstream comprehensive Lambda can fire the byte-gate on PDF re-fetch", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({
				url: "https://example.com/doc.pdf",
				refresh: true,
				previousBodyHash: "h".repeat(64),
			}),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			userId: undefined,
			recrawl: undefined,
			refresh: true,
			previousBodyHash: "h".repeat(64),
		});
	});

	it("dispatches ComprehensiveCrawlCommand without userId for anonymous saves", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/blob" }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/blob",
			userId: undefined,
			recrawl: undefined,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("reports the record as a batch failure when publishEvent throws (so SQS retries)", async () => {
		const publishEvent = jest.fn().mockRejectedValue(new Error("EventBridge throttled"));

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(publishEvent).not.toHaveBeenCalled();
	});
});
