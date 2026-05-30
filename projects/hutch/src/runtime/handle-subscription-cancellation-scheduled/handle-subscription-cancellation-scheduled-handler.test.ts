import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initHandleSubscriptionCancellationScheduledHandler } from "./handle-subscription-cancellation-scheduled-handler";

const USER_ID = UserIdSchema.parse("user-cancel-scheduled");

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

function buildEventBridgeBody(detail: {
	userId: string;
	subscriptionId?: string;
	cancellationEffectiveAt: string;
}): string {
	return JSON.stringify({
		detail: {
			userId: detail.userId,
			...(detail.subscriptionId !== undefined ? { subscriptionId: detail.subscriptionId } : {}),
			cancellationEffectiveAt: detail.cancellationEffectiveAt,
		},
	});
}

describe("handle-subscription-cancellation-scheduled-handler", () => {
	it("calls markPendingCancellation with the userId and cancellationEffectiveAt from the event", async () => {
		const calls: Array<{ userId: string; cancellationEffectiveAt: string }> = [];
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async ({ userId, cancellationEffectiveAt }) => {
				calls.push({ userId, cancellationEffectiveAt });
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-paid",
					body: buildEventBridgeBody({
						userId: USER_ID,
						subscriptionId: "sub_paid",
						cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(calls, [
			{ userId: USER_ID, cancellationEffectiveAt: "2026-06-22T10:00:00.000Z" },
		]);
	});

	it("handles trial cancel events (no subscriptionId) by passing through to markPendingCancellation", async () => {
		const calls: Array<{ userId: string; cancellationEffectiveAt: string }> = [];
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async ({ userId, cancellationEffectiveAt }) => {
				calls.push({ userId, cancellationEffectiveAt });
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-trial",
					body: buildEventBridgeBody({
						userId: USER_ID,
						cancellationEffectiveAt: "2026-06-05T00:00:00.000Z",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(calls, [
			{ userId: USER_ID, cancellationEffectiveAt: "2026-06-05T00:00:00.000Z" },
		]);
	});

	it("reports a batch item failure when markPendingCancellation throws", async () => {
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async () => {
				throw new Error("DynamoDB timeout");
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-fail",
					body: buildEventBridgeBody({
						userId: USER_ID,
						cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
	});

	it("reports a batch item failure for malformed JSON without dropping the batch", async () => {
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-bad", body: "not-json" },
				{
					messageId: "msg-good",
					body: buildEventBridgeBody({
						userId: USER_ID,
						cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when the detail is missing cancellationEffectiveAt", async () => {
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-schema", body: JSON.stringify({ detail: { userId: USER_ID } }) },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("idempotent on duplicate delivery — same userId + cancellationEffectiveAt routed twice produces a second markPendingCancellation that the provider treats as the same write", async () => {
		const calls: Array<{ userId: string; cancellationEffectiveAt: string }> = [];
		const handler = initHandleSubscriptionCancellationScheduledHandler({
			markPendingCancellation: async ({ userId, cancellationEffectiveAt }) => {
				calls.push({ userId, cancellationEffectiveAt });
			},
			logger: HutchLogger.from(noopLogger),
		});

		const body = buildEventBridgeBody({
			userId: USER_ID,
			subscriptionId: "sub_paid",
			cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-1", body },
				{ messageId: "msg-2-dup", body },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls[0], calls[1]);
	});
});
