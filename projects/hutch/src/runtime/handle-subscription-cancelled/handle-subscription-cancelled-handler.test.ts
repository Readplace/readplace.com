import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initHandleSubscriptionCancelledHandler } from "./handle-subscription-cancelled-handler";

function buildSqsEvent(records: Array<{ messageId: string; body: string }>): SQSEvent {
	return {
		Records: records.map((r) => ({
			messageId: r.messageId,
			receiptHandle: "handle",
			body: r.body,
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "0",
				SenderId: "sender",
				ApproximateFirstReceiveTimestamp: "0",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:us-east-1:123456789:test-queue",
			awsRegion: "us-east-1",
		})),
	};
}

function buildEventBridgeBody(subscriptionId: string): string {
	return JSON.stringify({ detail: { subscriptionId } });
}

describe("handle-subscription-cancelled-handler", () => {
	it("marks the subscription as cancelled for a valid event", async () => {
		const cancelled: string[] = [];
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelled: async ({ subscriptionId }) => { cancelled.push(subscriptionId); },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-1", body: buildEventBridgeBody("sub_to_cancel") }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepStrictEqual(cancelled, ["sub_to_cancel"]);
	});

	it("reports a batch item failure when markCancelled throws", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelled: async () => { throw new Error("DynamoDB timeout"); },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-fail", body: buildEventBridgeBody("sub_fail") }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelled: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "not-json" }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when the detail is missing subscriptionId", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelled: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-schema", body: JSON.stringify({ detail: {} }) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("processes multiple records and only fails the broken ones", async () => {
		const cancelled: string[] = [];
		let callCount = 0;
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelled: async ({ subscriptionId }) => {
				callCount++;
				if (subscriptionId === "sub_boom") throw new Error("boom");
				cancelled.push(subscriptionId);
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-ok-1", body: buildEventBridgeBody("sub_ok_1") },
				{ messageId: "msg-boom", body: buildEventBridgeBody("sub_boom") },
				{ messageId: "msg-ok-2", body: buildEventBridgeBody("sub_ok_2") },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(callCount, 3);
		assert.deepStrictEqual(cancelled, ["sub_ok_1", "sub_ok_2"]);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-boom");
	});
});
