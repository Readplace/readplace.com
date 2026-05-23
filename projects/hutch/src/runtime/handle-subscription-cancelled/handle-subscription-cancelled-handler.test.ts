import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initHandleSubscriptionCancelledHandler } from "./handle-subscription-cancelled-handler";

const USER_ID = UserIdSchema.parse("user-cancel");

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
	reason?: "stripe_webhook" | "user_initiated_trial" | "user_initiated_paid_confirmed";
}): string {
	return JSON.stringify({
		detail: {
			userId: detail.userId,
			...(detail.subscriptionId !== undefined ? { subscriptionId: detail.subscriptionId } : {}),
			reason: detail.reason ?? "stripe_webhook",
		},
	});
}

describe("handle-subscription-cancelled-handler", () => {
	it("marks the subscription as cancelled by userId for a valid Stripe-originated event", async () => {
		const cancelledUserIds: string[] = [];
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelledByUserId: async ({ userId }) => { cancelledUserIds.push(userId); },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-1",
					body: buildEventBridgeBody({ userId: USER_ID, subscriptionId: "sub_x", reason: "stripe_webhook" }),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepStrictEqual(cancelledUserIds, [USER_ID]);
	});

	it("marks cancelled for a trial-initiated event with no subscriptionId", async () => {
		const cancelledUserIds: string[] = [];
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelledByUserId: async ({ userId }) => { cancelledUserIds.push(userId); },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-trial",
					body: buildEventBridgeBody({ userId: USER_ID, reason: "user_initiated_trial" }),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepStrictEqual(cancelledUserIds, [USER_ID]);
	});

	it("reports a batch item failure when markCancelledByUserId throws", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelledByUserId: async () => { throw new Error("DynamoDB timeout"); },
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-fail", body: buildEventBridgeBody({ userId: USER_ID }) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelledByUserId: async () => {},
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

	it("reports a batch item failure when the detail is missing userId", async () => {
		const handler = initHandleSubscriptionCancelledHandler({
			markCancelledByUserId: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-schema", body: JSON.stringify({ detail: { reason: "stripe_webhook" } }) }]),
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
			markCancelledByUserId: async ({ userId }) => {
				callCount++;
				if (userId === "user-boom") throw new Error("boom");
				cancelled.push(userId);
			},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-ok-1", body: buildEventBridgeBody({ userId: "user-ok-1" }) },
				{ messageId: "msg-boom", body: buildEventBridgeBody({ userId: "user-boom" }) },
				{ messageId: "msg-ok-2", body: buildEventBridgeBody({ userId: "user-ok-2" }) },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(callCount, 3);
		assert.deepStrictEqual(cancelled, ["user-ok-1", "user-ok-2"]);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-boom");
	});
});
