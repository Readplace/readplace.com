import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed-handler";

const USER_ID = UserIdSchema.parse("3".repeat(32));

describe("subscription-charge-failed handler", () => {
	it("publishes CancelSubscriptionCommand with the failed-event userId", async () => {
		const published: Array<{ userId: string }> = [];
		const publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand = async (
			params,
		) => {
			published.push({ userId: params.userId });
		};
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand,
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
	});

	it("also fires CancelSubscriptionCommand for reason=stripe_error", async () => {
		const published: Array<{ userId: string }> = [];
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async (params) => {
				published.push({ userId: params.userId });
			},
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
		assert.equal(published[0].userId, USER_ID);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {},
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
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {},
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

	it("reports a batch item failure when publishCancelSubscriptionCommand throws", async () => {
		const handler = initSubscriptionChargeFailedHandler({
			publishCancelSubscriptionCommand: async () => {
				throw new Error("EventBridge unavailable");
			},
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
	});
});
