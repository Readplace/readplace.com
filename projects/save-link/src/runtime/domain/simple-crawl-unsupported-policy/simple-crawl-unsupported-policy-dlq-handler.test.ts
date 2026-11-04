import { noopLogger, type Logger } from "@packages/logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { RecrawlContentExtractedEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { initSimpleCrawlUnsupportedPolicyDlqHandler } from "./simple-crawl-unsupported-policy-dlq-handler";
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
	detail: { url: string; userId?: string; recrawl?: boolean; candidates?: Array<{ id: string; tier: "tier-2" }> },
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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy-dlq",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSimpleCrawlUnsupportedPolicyDlqHandler", () => {
	it("dispatches the markCrawlExhausted transition with the URL, reason, and receiveCount from the DLQ record", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyDlqHandler({
			transitionAndPersist,
			publishEvent: async () => {},
			logger: noopLogger,
			now: () => new Date(),
		});

		await handler(
			createSqsEvent({ url: "https://example.com/scan.pdf", userId: "user-1" }, 4),
			buildLambdaContext(),
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/scan.pdf",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 4 },
				receiveCount: 4,
			},
		});
	});

	it("reports the record as a batch failure on invalid event envelope (Zod failure) and does NOT dispatch the transition", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn();

		const handler = initSimpleCrawlUnsupportedPolicyDlqHandler({
			transitionAndPersist,
			publishEvent: async () => {},
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy-dlq",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("logs one structured ERROR line with the URL, receive count and messageId after the exhausted transition", async () => {
		const calls: unknown[][] = [];
		const transitionAndPersist: TransitionAndPersist = jest.fn(async () => {
			calls.push(["transition"]);
		});
		const logger: Logger = {
			...noopLogger,
			error: (...args) => {
				calls.push(args);
			},
		};
		const handler = initSimpleCrawlUnsupportedPolicyDlqHandler({
			transitionAndPersist,
			publishEvent: async () => {},
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		await handler(createSqsEvent({ url: "https://example.com/failed" }, 4), buildLambdaContext(), () => {});

		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual(["transition"]);
		expect(calls[1]).toEqual(["[SimpleCrawlUnsupportedPolicyDlq] dead-lettered after 4 receives (messageId msg-1); marking crawl exhausted", { url: "https://example.com/failed" }]);
	});

	it("a throwing transition logs only the record-failed line", async () => {
		const calls: unknown[][] = [];
		const transitionAndPersist: TransitionAndPersist = jest.fn(async () => {
			throw new Error("ddb down");
		});
		const logger: Logger = {
			...noopLogger,
			error: (...args) => {
				calls.push(args);
			},
		};
		const handler = initSimpleCrawlUnsupportedPolicyDlqHandler({
			transitionAndPersist,
			publishEvent: async () => {},
			logger,
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});

		const result = await handler(createSqsEvent({ url: "https://example.com/failed" }, 4), buildLambdaContext(), () => {});

		expect(calls.map((c) => c[0])).toEqual(["[SimpleCrawlUnsupportedPolicyDlq] record failed"]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});

describe("initSimpleCrawlUnsupportedPolicyDlqHandler with stored candidates", () => {
	const wrapper = { id: "wrapper-candidate", tier: "tier-2" as const };

	function createHandler(publishEvent: PublishEvent = async () => {}) {
		const published: Array<{ detailType: string; detail: unknown }> = [];
		const logged: unknown[][] = [];
		const transitionAndPersist = jest.fn(async () => {});
		const handler = initSimpleCrawlUnsupportedPolicyDlqHandler({
			transitionAndPersist,
			publishEvent: async (event, detail) => {
				await publishEvent(event, detail);
				published.push({ detailType: event.detailType, detail });
			},
			logger: { ...noopLogger, error: (...args) => { logged.push(args); } },
			now: () => new Date("2026-10-15T04:43:01.000Z"),
		});
		return { handler, published, logged, transitionAndPersist };
	}

	it("selects over the stored candidates with an exhausted-retries live attempt instead of marking the crawl exhausted", async () => {
		const { handler, published, logged, transitionAndPersist } = createHandler();

		const result = await handler(createSqsEvent({ url: "https://example.com/scan.pdf", userId: "user-1", candidates: [wrapper] }, 1), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([{
			detailType: TierContentExtractedEvent.detailType,
			detail: {
				url: "https://example.com/scan.pdf",
				userId: "user-1",
				saveAttemptId: "attempt-1",
				candidates: [wrapper],
				liveAttempt: { outcome: "no-body", failureReason: { kind: "exhausted-retries", receiveCount: 1 } },
				extractedAt: "2026-10-15T04:43:01.000Z",
			},
		}]);
		expect(transitionAndPersist.mock.calls).toEqual([]);
		expect(logged.map((args) => args[0])).toEqual([
			"[SimpleCrawlUnsupportedPolicyDlq] dead-lettered after 1 receives (messageId msg-1); selecting over stored candidates",
		]);
	});

	it("publishes the recrawl selection when the dead-lettered message is a recrawl", async () => {
		const { handler, published } = createHandler();

		await handler(createSqsEvent({ url: "https://example.com/scan.pdf", recrawl: true, candidates: [wrapper] }, 1), buildLambdaContext(), () => {});

		expect(published.map((p) => p.detailType)).toEqual([RecrawlContentExtractedEvent.detailType]);
	});

	it("marks the crawl exhausted when the message carries an empty candidate list", async () => {
		const { handler, published, transitionAndPersist } = createHandler();

		await handler(createSqsEvent({ url: "https://example.com/scan.pdf", candidates: [] }, 2), buildLambdaContext(), () => {});

		expect(published).toEqual([]);
		expect(transitionAndPersist.mock.calls).toEqual([[markCrawlExhausted, {
			url: "https://example.com/scan.pdf",
			input: { reason: { kind: "exhausted-retries", receiveCount: 2 }, receiveCount: 2 },
		}]]);
	});

	it("reports the record as a batch failure when the selection publish throws", async () => {
		const { handler } = createHandler(async () => {
			throw new Error("eventbridge down");
		});

		const result = await handler(createSqsEvent({ url: "https://example.com/scan.pdf", candidates: [wrapper] }, 1), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
