import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "../observability/subscription-events";

const USER_ID = UserIdSchema.parse("3".repeat(32));

function makeEmit(): { emit: ReturnType<typeof initEmitSubscriptionEvent>; captured: SubscriptionLogEvent[] } {
	const captured: SubscriptionLogEvent[] = [];
	const emit = initEmitSubscriptionEvent({
		logger: {
			info: (data) => { captured.push(data); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		},
		now: () => new Date("2026-06-06T00:00:00.000Z"),
	});
	return { emit, captured };
}

describe("subscription-charge-failed handler", () => {
	it("emits charge_failed and publishes CancelSubscriptionCommand with the failed-event userId", async () => {
		const published: Array<{ userId: string }> = [];
		const publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand = async (
			params,
		) => {
			published.push({ userId: params.userId });
		};
		const { emit, captured } = makeEmit();
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand,
			emit,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-fail",
					body: JSON.stringify({
						detail: { userId: USER_ID, reason: "no_card_on_file" },
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(published.length, 1);
		assert.equal(published[0].userId, USER_ID);
		assert.deepEqual(captured, [{
			stream: "subscriptions",
			event: "charge_failed",
			timestamp: "2026-06-06T00:00:00.000Z",
			user_id: USER_ID,
			reason: "no_card_on_file",
		}]);
	});

	it("emits charge_failed with reason=stripe_error so the dashboard can split the two failure modes", async () => {
		const published: Array<{ userId: string }> = [];
		const { emit, captured } = makeEmit();
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async (params) => {
				published.push({ userId: params.userId });
			},
			emit,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-fail-stripe",
					body: JSON.stringify({
						detail: { userId: USER_ID, reason: "stripe_error" },
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(published.length, 1);
		assert.equal(captured[0].reason, "stripe_error");
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const { emit } = makeEmit();
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {},
			emit,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "garbage" }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when reason is invalid", async () => {
		const { emit } = makeEmit();
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {},
			emit,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-schema",
					body: JSON.stringify({ detail: { userId: USER_ID, reason: "made_up" } }),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("reports a batch item failure when publishCancelSubscriptionCommand throws and does not emit (prevents duplicate on SQS retry)", async () => {
		const { emit, captured } = makeEmit();
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {
				throw new Error("EventBridge unavailable");
			},
			emit,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-publish-fail",
					body: JSON.stringify({
						detail: { userId: USER_ID, reason: "no_card_on_file" },
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-publish-fail");
		assert.equal(captured.length, 0);
	});
});
