import { noopLogger } from "@packages/hutch-logger";
import {
	markCrawlExhausted,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initReselectAfterRemovalDlqHandler } from "./reselect-after-removal-dlq-handler";
import type { SQSRecord, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

function attributes(receiveCount: number): SQSRecordAttributes {
	return {
		ApproximateReceiveCount: String(receiveCount),
		SentTimestamp: "1620000000000",
		SenderId: "TESTID",
		ApproximateFirstReceiveTimestamp: "1620000000001",
	};
}

function createRecord(detail: unknown, receiveCount: number, messageId = "msg-1"): SQSRecord {
	return {
		messageId,
		receiptHandle: `receipt-${messageId}`,
		body: JSON.stringify({ detail }),
		attributes: attributes(receiveCount),
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:reselect-after-removal-dlq",
		awsRegion: "ap-southeast-2",
	};
}

describe("initReselectAfterRemovalDlqHandler", () => {
	it("marks the crawl exhausted with the DLQ receiveCount when a post-removal reselect never lands", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined) as unknown as TransitionAndPersist;

		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			{ Records: [createRecord({ url: "https://example.com/post" }, 4)] },
			buildLambdaContext(),
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/post",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 4 },
				receiveCount: 4,
			},
		});
	});

	it("reports the record as a batch failure on invalid detail", async () => {
		const transitionAndPersist = jest.fn() as unknown as TransitionAndPersist;

		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			{ Records: [createRecord({ invalid: true }, 3)] },
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when the transition throws", async () => {
		const transitionAndPersist = jest
			.fn()
			.mockRejectedValue(new Error("ddb throttled")) as unknown as TransitionAndPersist;

		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			{ Records: [createRecord({ url: "https://example.com/post" }, 4)] },
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("returns an empty batchItemFailures when there are no records", async () => {
		const transitionAndPersist = jest.fn() as unknown as TransitionAndPersist;

		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler({ Records: [] }, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});
});
