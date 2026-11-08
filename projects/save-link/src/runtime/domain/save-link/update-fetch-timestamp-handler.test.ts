import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { type Logger, noopLogger } from "@packages/logger";
import { type AdvanceContentFetchedAt, initUpdateFetchTimestampHandler } from "./update-fetch-timestamp-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

const URL_UNDER_TEST = "https://example.com/article";
const FETCHED_AT = "2026-04-10T12:00:00.000Z";

function createSqsEvent(detail: Record<string, unknown>): SQSEvent {
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

function createFakeAdvance(answer: () => Promise<"advanced" | "superseded">) {
	const calls: Parameters<AdvanceContentFetchedAt>[0][] = [];
	const advanceContentFetchedAt: AdvanceContentFetchedAt = async (params) => {
		calls.push(params);
		return answer();
	};
	return { advanceContentFetchedAt, calls };
}

function createRecordingLogger() {
	const infoLines: unknown[][] = [];
	const logger: Logger = {
		...noopLogger,
		info: (...args: unknown[]) => {
			infoLines.push(args);
		},
	};
	return { logger, infoLines };
}

describe("initUpdateFetchTimestampHandler", () => {
	it("ignores a dead-lettered message's stale bodyHash", async () => {
		const { advanceContentFetchedAt, calls } = createFakeAdvance(async () => "advanced");
		const handler = initUpdateFetchTimestampHandler({ advanceContentFetchedAt, logger: noopLogger });

		const result = await handler(
			createSqsEvent({ url: URL_UNDER_TEST, contentFetchedAt: FETCHED_AT, bodyHash: "stale" }),
			buildLambdaContext(),
			() => {},
		);

		expect(calls).toStrictEqual([{ url: URL_UNDER_TEST, contentFetchedAt: FETCHED_AT }]);
		expect(result).toEqual({ batchItemFailures: [] });
	});

	it.each(["superseded", "advanced"] as const)("treats a %s stamp as success and logs the outcome", async (outcome) => {
		const { advanceContentFetchedAt } = createFakeAdvance(async () => outcome);
		const { logger, infoLines } = createRecordingLogger();
		const handler = initUpdateFetchTimestampHandler({ advanceContentFetchedAt, logger });

		const result = await handler(
			createSqsEvent({ url: URL_UNDER_TEST, contentFetchedAt: FETCHED_AT }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(infoLines).toContainEqual(["[UpdateFetchTimestamp] completed", { url: URL_UNDER_TEST, outcome }]);
	});

	it("reports a provider failure as a batch failure", async () => {
		const { advanceContentFetchedAt } = createFakeAdvance(async () => {
			throw new Error("throttled");
		});
		const handler = initUpdateFetchTimestampHandler({ advanceContentFetchedAt, logger: noopLogger });

		const result = await handler(
			createSqsEvent({ url: URL_UNDER_TEST, contentFetchedAt: FETCHED_AT }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const { advanceContentFetchedAt, calls } = createFakeAdvance(async () => "advanced");
		const handler = initUpdateFetchTimestampHandler({ advanceContentFetchedAt, logger: noopLogger });

		const result = await handler(createSqsEvent({ invalid: true }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(calls).toEqual([]);
	});
});
