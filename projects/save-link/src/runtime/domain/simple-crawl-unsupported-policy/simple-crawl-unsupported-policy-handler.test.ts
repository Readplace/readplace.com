import { noopLogger } from "@packages/hutch-logger";
import { initSimpleCrawlUnsupportedPolicyHandler } from "./simple-crawl-unsupported-policy-handler";
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
	userId?: string;
	recrawl?: boolean;
	refresh?: boolean;
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
			stubContext,
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({
				url: "https://example.com/doc.pdf",
				userId: "user-1",
				recrawl: undefined,
				refresh: undefined,
			}),
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
			stubContext,
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({
				url: "https://example.com/doc.pdf",
				userId: undefined,
				recrawl: true,
				refresh: undefined,
			}),
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
			stubContext,
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({
				url: "https://example.com/doc.pdf",
				userId: undefined,
				recrawl: undefined,
				refresh: true,
			}),
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
			stubContext,
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({
				url: "https://example.com/blob",
				userId: undefined,
				recrawl: undefined,
				refresh: undefined,
			}),
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
			stubContext,
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

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(publishEvent).not.toHaveBeenCalled();
	});
});
