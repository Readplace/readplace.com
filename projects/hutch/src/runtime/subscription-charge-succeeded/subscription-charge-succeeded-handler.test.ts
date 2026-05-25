import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionChargeSucceededHandler } from "./subscription-charge-succeeded-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "../observability/subscription-events";

const USER_ID = UserIdSchema.parse("2".repeat(32));

function buildBody(detail: {
	userId: string;
	subscriptionId: string;
	customerId: string;
}): string {
	return JSON.stringify({ detail });
}

function setup() {
	const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-06-06T00:00:00.000Z") });
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
	const handler = initSubscriptionChargeSucceededHandler({
		upsertActive: providers.upsertActive,
		emit,
		logger: HutchLogger.from(noopLogger),
	});
	return { providers, captured, handler };
}

describe("subscription-charge-succeeded handler", () => {
	it("upserts an active row from the event payload and emits a charge_succeeded log line for the dashboard", async () => {
		const { providers, captured, handler } = setup();
		await providers.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-20T00:00:00.000Z" });

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
		assert.deepEqual(captured, [{
			stream: "subscriptions",
			event: "charge_succeeded",
			timestamp: "2026-06-06T00:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_brand_new",
		}]);
	});

	it("clears chargeFailedAt and chargeRequestedAt sentinels on the row when activating", async () => {
		const { providers, handler } = setup();
		providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_was",
			paymentMethodId: "pm_was",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			chargeFailedAt: "2026-05-01T00:00:00.000Z",
			chargeFailedReason: "card_declined",
			chargeRequestedAt: "2026-05-01T00:00:00.000Z",
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-05-01T00:00:00.000Z",
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-clear",
					body: buildBody({
						userId: USER_ID,
						subscriptionId: "sub_fresh",
						customerId: "cus_was",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const row = await providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.status, "active");
		assert.equal(row.chargeFailedAt, undefined);
		assert.equal(row.chargeFailedReason, undefined);
		assert.equal(row.chargeRequestedAt, undefined);
	});

	it("reports a batch item failure for malformed JSON and emits no subscription event", async () => {
		const { captured, handler } = setup();

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "{not-json" }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
		assert.deepEqual(captured, []);
	});

	it("reports a batch item failure when the detail is missing subscriptionId", async () => {
		const { handler } = setup();

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
