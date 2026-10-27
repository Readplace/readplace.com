import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initSaveAnonymousLinkDlqHandler } from "./save-anonymous-link-dlq-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

function attributes(receiveCount: number): SQSRecordAttributes {
	return {
		ApproximateReceiveCount: String(receiveCount),
		SentTimestamp: "1620000000000",
		SenderId: "TESTID",
		ApproximateFirstReceiveTimestamp: "1620000000001",
	};
}

function createSqsEvent(
	detail: { url: string; captureUrl?: string },
	receiveCount = 3,
): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { ...detail, saveAttemptId: "attempt-1" } }),
			attributes: attributes(receiveCount),
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:save-anonymous-link-command-dlq",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSaveAnonymousLinkDlqHandler", () => {
	it("dispatches the markCrawlExhausted transition with the URL, reason, and receiveCount from the DLQ record", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
			now: () => new Date(),
		});

		await handler(
			createSqsEvent({ url: "https://example.com/failed" }, 2),
			buildLambdaContext(),
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/failed",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 2 },
				receiveCount: 2,
			},
		});
	});

	it("reports the record as a batch failure on invalid command envelope (Zod failure) and does NOT dispatch the transition", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn();

		const handler = initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
			now: () => new Date(),
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: attributes(3),
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:save-anonymous-link-command-dlq",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when the transition throws (SQS redelivers; canary catches the stuck row)", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockRejectedValue(new Error("ddb throttled"));

		const handler = initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
			now: () => new Date(),
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/failed" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("marks the original's crawl exhausted when a dead-lettered command carried an archive capture", async () => {
		const CAPTURE = "https://web.archive.org/web/20081203185222/https://example.com/article";
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = initSaveAnonymousLinkDlqHandler({ transitionAndPersist, logger: noopLogger, now: () => new Date() });

		const result = await handler(createSqsEvent({ url: "https://example.com/article", captureUrl: CAPTURE }), buildLambdaContext(), () => {});

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/article",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 3 },
				receiveCount: 3,
			},
		});
		expect(result).toEqual({ batchItemFailures: [] });
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
		const handler = initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		await handler(createSqsEvent({ url: "https://example.com/failed" }, 4), buildLambdaContext(), () => {});

		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual(["transition"]);
		expect(calls[1]).toHaveLength(1);
		expect(JSON.parse(String(calls[1]?.[0]))).toEqual({
			level: "ERROR",
			timestamp: "2026-10-15T04:43:01.000Z",
			message: "[SaveAnonymousLinkDlq] dead-lettered after 4 receives (messageId msg-1); marking crawl exhausted",
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
		const handler = initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		const result = await handler(createSqsEvent({ url: "https://example.com/failed" }, 4), buildLambdaContext(), () => {});

		expect(calls.map((c) => c[0])).toEqual(["[SaveAnonymousLinkDlq] record failed"]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
