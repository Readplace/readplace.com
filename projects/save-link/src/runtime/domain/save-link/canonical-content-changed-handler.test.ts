import { noopLogger } from "@packages/hutch-logger";
import {
	markSummaryPending,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initCanonicalContentChangedHandler } from "./canonical-content-changed-handler";
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

const FIXED_NOW = new Date("2026-05-31T10:00:00.000Z");

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:canonical-content-changed",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initCanonicalContentChangedHandler", () => {
	it("re-primes the summary via markSummaryPending when the canonical content is readable", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => ({ content: "<p>Some content</p>" });

		const handler = initCanonicalContentChangedHandler({
			transitionAndPersist,
			findArticleContent,
			now: () => FIXED_NOW,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: "https://example.com/article" }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markSummaryPending, {
			url: "https://example.com/article",
			input: { now: FIXED_NOW.toISOString() },
		});
	});

	it("reports batchItemFailures when canonical content is not yet readable so SQS redelivers through maxReceiveCount", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => undefined;

		const handler = initCanonicalContentChangedHandler({
			transitionAndPersist,
			findArticleContent,
			now: () => FIXED_NOW,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/no-content" }),
			stubContext,
			() => {},
		);

		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const findArticleContent: FindArticleContent = async () => ({ content: "content" });

		const handler = initCanonicalContentChangedHandler({
			transitionAndPersist,
			findArticleContent,
			now: () => FIXED_NOW,
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:canonical-content-changed",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
