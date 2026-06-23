import { noopLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initRecrawlLinkInitiatedDlqHandler } from "./recrawl-link-initiated-dlq-handler";
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
	detail: { url: string },
	receiveCount = 3,
): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: attributes(receiveCount),
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:recrawl-link-initiated-dlq",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initRecrawlLinkInitiatedDlqHandler", () => {
	it("dispatches the markCrawlExhausted transition with the URL, reason, and receiveCount from the DLQ record", async () => {
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = initRecrawlLinkInitiatedDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/failed" }, 4),
			buildLambdaContext(),
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/failed",
			input: {
				reason: { kind: "exhausted-retries", receiveCount: 4 },
				receiveCount: 4,
			},
		});
	});

	it("reports the record as a batch failure on invalid event envelope (Zod failure) and does NOT dispatch the transition", async () => {
		const transitionAndPersist: TransitionAndPersist = jest.fn();

		const handler = initRecrawlLinkInitiatedDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:recrawl-link-initiated-dlq",
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

		const handler = initRecrawlLinkInitiatedDlqHandler({
			transitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/failed" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
