import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initHandleByDetailType } from "./handle-by-detail-type";

function recordingHandler(options?: { failing?: boolean }): {
	handler: Handler<SQSEvent, SQSBatchResponse>;
	seen: string[][];
} {
	const seen: string[][] = [];
	const handler: Handler<SQSEvent, SQSBatchResponse> = async (event) => {
		seen.push(event.Records.map((r) => r.messageId));
		return {
			batchItemFailures: options?.failing
				? event.Records.map((r) => ({ itemIdentifier: r.messageId }))
				: [],
		};
	};
	return { handler, seen };
}

function envelope(detailType: string): string {
	return JSON.stringify({ "detail-type": detailType, detail: {} });
}

function run(
	handler: Handler<SQSEvent, SQSBatchResponse>,
	records: Array<{ messageId: string; body: string }>,
) {
	return handler(buildSqsEvent(records), buildLambdaContext(), () => {});
}

describe("handle-by-detail-type", () => {
	it("hands each record only to the handlers registered for its detail-type", async () => {
		const cancelled = recordingHandler();
		const charged = recordingHandler();
		const handler = initHandleByDetailType({
			routes: {
				SubscriptionCancelled: [cancelled.handler],
				SubscriptionChargeSucceeded: [charged.handler],
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await run(handler, [
			{ messageId: "msg-1", body: envelope("SubscriptionCancelled") },
			{ messageId: "msg-2", body: envelope("SubscriptionChargeSucceeded") },
		]);

		assert(result);
		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(cancelled.seen, [["msg-1"]]);
		assert.deepEqual(charged.seen, [["msg-2"]]);
	});

	it("delivers every record of one detail-type to its handler in a single invocation", async () => {
		const cancelled = recordingHandler();
		const handler = initHandleByDetailType({
			routes: { SubscriptionCancelled: [cancelled.handler] },
			logger: HutchLogger.from(noopLogger),
		});

		await run(handler, [
			{ messageId: "msg-1", body: envelope("SubscriptionCancelled") },
			{ messageId: "msg-2", body: envelope("SubscriptionCancelled") },
		]);

		assert.deepEqual(cancelled.seen, [["msg-1", "msg-2"]]);
	});

	it("fans one detail-type out to every handler registered for it", async () => {
		const markCancelled = recordingHandler();
		const scheduleFeedback = recordingHandler();
		const handler = initHandleByDetailType({
			routes: { SubscriptionCancelled: [markCancelled.handler, scheduleFeedback.handler] },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await run(handler, [
			{ messageId: "msg-1", body: envelope("SubscriptionCancelled") },
		]);

		assert(result);
		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(markCancelled.seen, [["msg-1"]]);
		assert.deepEqual(scheduleFeedback.seen, [["msg-1"]]);
	});

	it("reports a record once when more than one handler for its detail-type fails it", async () => {
		const markCancelled = recordingHandler({ failing: true });
		const scheduleFeedback = recordingHandler({ failing: true });
		const handler = initHandleByDetailType({
			routes: { SubscriptionCancelled: [markCancelled.handler, scheduleFeedback.handler] },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await run(handler, [
			{ messageId: "msg-1", body: envelope("SubscriptionCancelled") },
		]);

		assert(result);
		assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
	});

	it("fails only the record whose detail-type no handler claims, so an unrouted event reaches the DLQ instead of vanishing", async () => {
		const cancelled = recordingHandler();
		const errorLines: unknown[][] = [];
		const handler = initHandleByDetailType({
			routes: { SubscriptionCancelled: [cancelled.handler] },
			logger: HutchLogger.from({
				info: () => {},
				error: (...args) => { errorLines.push(args); },
				warn: () => {},
				debug: () => {},
			}),
		});

		const result = await run(handler, [
			{ messageId: "msg-1", body: envelope("SubscriptionCancelled") },
			{ messageId: "msg-2", body: envelope("SubscriptionReactivated") },
		]);

		assert(result);
		assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg-2" }]);
		assert.deepEqual(cancelled.seen, [["msg-1"]]);
		assert.equal(errorLines.length, 1);
		assert.equal(errorLines[0][0], "[handle-by-detail-type] record failed");
	});

	it("fails a record whose body is not an EventBridge envelope", async () => {
		const cancelled = recordingHandler();
		const handler = initHandleByDetailType({
			routes: { SubscriptionCancelled: [cancelled.handler] },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await run(handler, [{ messageId: "msg-1", body: "not json" }]);

		assert(result);
		assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
		assert.deepEqual(cancelled.seen, []);
	});
});
