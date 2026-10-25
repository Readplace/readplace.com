import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
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
			now: () => new Date(),
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
			now: () => new Date(),
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
			now: () => new Date(),
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
			now: () => new Date(),
		});

		const result = await handler({ Records: [] }, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("logs one structured ERROR line with the URL, receive count and messageId after the exhausted transition", async () => {
		const calls: unknown[][] = [];
		const transitionAndPersist: TransitionAndPersist = jest.fn(async () => {
			calls.push(["transition"]);
		});
		const logger: HutchLogger = {
			...noopLogger,
			error: (...args) => {
				calls.push(args);
			},
		};
		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		await handler({ Records: [createRecord({ url: "https://example.com/failed" }, 4)] }, buildLambdaContext(), () => {});

		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual(["transition"]);
		expect(calls[1]).toHaveLength(1);
		expect(JSON.parse(String(calls[1]?.[0]))).toEqual({
			level: "ERROR",
			timestamp: "2026-10-15T04:43:01.000Z",
			message: "[ReselectAfterRemovalDlq] dead-lettered after 4 receives (messageId msg-1); marking crawl exhausted",
			url: "https://example.com/failed",
		});
	});

	it("a throwing transition logs only the record-failed line", async () => {
		const calls: unknown[][] = [];
		const transitionAndPersist: TransitionAndPersist = jest.fn(async () => {
			throw new Error("ddb down");
		});
		const logger: HutchLogger = {
			...noopLogger,
			error: (...args) => {
				calls.push(args);
			},
		};
		const handler = initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		const result = await handler({ Records: [createRecord({ url: "https://example.com/failed" }, 4)] }, buildLambdaContext(), () => {});

		expect(calls.map((c) => c[0])).toEqual(["[ReselectAfterRemovalDlq] record failed"]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
