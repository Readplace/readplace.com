import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionChargeSucceededHandler } from "./subscription-charge-succeeded-handler";

const USER_ID = UserIdSchema.parse("2".repeat(32));

function buildBody(detail: {
	userId: string;
	subscriptionId: string;
	customerId: string;
}): string {
	return JSON.stringify({ detail });
}

describe("subscription-charge-succeeded handler", () => {
	it("upserts an active row from the event payload", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-06-06T00:00:00.000Z") });
		// Seed a prior trialing row so the test verifies the transition.
		await providers.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-20T00:00:00.000Z" });
		const handler = initSubscriptionChargeSucceededHandler({
			upsertActive: providers.upsertActive,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-charge-success",
					body: buildBody({
						userId: USER_ID,
						subscriptionId: "sub_brand_new",
						customerId: "cus_brand_new",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const row = await providers.findByUserId(USER_ID);
		assert(row, "row must exist");
		assert.equal(row.status, "active");
		assert.equal(row.subscriptionId, "sub_brand_new");
		assert.equal(row.customerId, "cus_brand_new");
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-06-06T00:00:00.000Z") });
		const handler = initSubscriptionChargeSucceededHandler({
			upsertActive: providers.upsertActive,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "{not-json" }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when the detail is missing subscriptionId", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-06-06T00:00:00.000Z") });
		const handler = initSubscriptionChargeSucceededHandler({
			upsertActive: providers.upsertActive,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{ messageId: "msg-schema", body: JSON.stringify({ detail: { userId: USER_ID, customerId: "cus_x" } }) },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-schema");
	});
});
