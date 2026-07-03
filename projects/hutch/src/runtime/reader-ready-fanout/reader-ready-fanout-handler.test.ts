import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initReaderReadyUsersNotificationFanoutHandler, type ReaderReadyUsersNotificationFanoutDeps } from "./reader-ready-fanout-handler";

const URL = "https://example.com/article";
const SUCCEEDED_AT = "2026-05-30T12:00:00.000Z";
const NOW = new Date("2026-05-30T12:05:00.000Z");

function sqsEvent(detail: unknown, messageId = "msg-1"): SQSEvent {
	return {
		Records: [{
			messageId,
			receiptHandle: "r",
			body: JSON.stringify({ detail }),
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "1",
				SenderId: "x",
				ApproximateFirstReceiveTimestamp: "1",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:1:reader-ready-fanout",
			awsRegion: "ap-southeast-2",
		}],
	};
}

function createHandler(overrides: Partial<ReaderReadyUsersNotificationFanoutDeps> = {}) {
	const deps: ReaderReadyUsersNotificationFanoutDeps = {
		findUserArticlesByUrl: jest.fn().mockResolvedValue([]),
		markReaderViewSucceeded: jest.fn().mockResolvedValue(undefined),
		enqueueDigestItem: jest.fn().mockResolvedValue(undefined),
		now: () => NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initReaderReadyUsersNotificationFanoutHandler(deps), deps };
}

describe("initReaderReadyUsersNotificationFanoutHandler", () => {
	it("stamps succeededAt for every saver and enqueues a digest item only for savers who viewed while loading (hasSummary=true)", async () => {
		const viewedSaver = { userId: UserIdSchema.parse("viewer"), viewedAt: new Date("2026-05-30T11:50:00.000Z") };
		const neverViewedSaver = { userId: UserIdSchema.parse("never"), viewedAt: undefined };
		const { handler, deps } = createHandler({
			findUserArticlesByUrl: jest.fn().mockResolvedValue([viewedSaver, neverViewedSaver]),
		});

		const result = await handler(
			sqsEvent({ url: URL, succeededAt: SUCCEEDED_AT, hasSummary: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.markReaderViewSucceeded).toHaveBeenCalledTimes(2);
		expect(deps.markReaderViewSucceeded).toHaveBeenCalledWith({ userId: "viewer", url: URL, at: new Date(SUCCEEDED_AT) });
		expect(deps.markReaderViewSucceeded).toHaveBeenCalledWith({ userId: "never", url: URL, at: new Date(SUCCEEDED_AT) });
		expect(deps.enqueueDigestItem).toHaveBeenCalledTimes(1);
		expect(deps.enqueueDigestItem).toHaveBeenCalledWith({ userId: "viewer", url: URL, enqueuedAt: NOW.toISOString() });
	});

	it("stamps succeededAt but enqueues nothing when the summary was skipped (hasSummary=false)", async () => {
		const viewedSaver = { userId: UserIdSchema.parse("viewer"), viewedAt: new Date("2026-05-30T11:50:00.000Z") };
		const { handler, deps } = createHandler({
			findUserArticlesByUrl: jest.fn().mockResolvedValue([viewedSaver]),
		});

		await handler(sqsEvent({ url: URL, succeededAt: SUCCEEDED_AT, hasSummary: false }), buildLambdaContext(), () => {});

		expect(deps.markReaderViewSucceeded).toHaveBeenCalledTimes(1);
		expect(deps.enqueueDigestItem).not.toHaveBeenCalled();
	});

	it("reports a batch item failure when fan-out throws so SQS redrives the record", async () => {
		const { handler } = createHandler({
			findUserArticlesByUrl: jest.fn().mockRejectedValue(new Error("dynamo down")),
		});

		const result = await handler(
			sqsEvent({ url: URL, succeededAt: SUCCEEDED_AT, hasSummary: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports a batch item failure on an invalid event detail", async () => {
		const { handler, deps } = createHandler();

		const result = await handler(sqsEvent({ url: URL }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.findUserArticlesByUrl).not.toHaveBeenCalled();
	});
});
