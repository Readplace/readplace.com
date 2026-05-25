import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { PublishSubscriptionStartRequestCommand } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initPaymentMethodAddedHandler } from "./payment-method-added-handler";

const USER_ID = UserIdSchema.parse("b".repeat(32));

function buildBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

function buildSubject() {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-06T00:00:00.000Z"),
	});
	const published: Array<{ userId: string }> = [];
	const publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand = async (
		params,
	) => {
		published.push({ userId: params.userId });
	};
	const handler = initPaymentMethodAddedHandler({
		findByUserIdConsistent: providers.findByUserIdConsistent,
		publishSubscriptionStartRequestCommand,
		logger: HutchLogger.from(noopLogger),
	});
	return { handler, providers, published };
}

describe("payment-method-added handler", () => {
	it("dispatches SubscriptionStartRequestCommand for a trialing row", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-20T00:00:00.000Z",
		});

		await subject.handler(buildSqsEvent([{ messageId: "msg-trial", body: buildBody(USER_ID) }]), {} as never, () => {});
		assert.deepEqual(subject.published, [{ userId: USER_ID }]);
	});

	it("dispatches SubscriptionStartRequestCommand for a cancelled row", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});

		await subject.handler(buildSqsEvent([{ messageId: "msg-cancelled", body: buildBody(USER_ID) }]), {} as never, () => {});
		assert.deepEqual(subject.published, [{ userId: USER_ID }]);
	});

	it("does not dispatch when the row is already active", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_a",
			customerId: "cus_a",
		});

		await subject.handler(buildSqsEvent([{ messageId: "msg-active", body: buildBody(USER_ID) }]), {} as never, () => {});
		assert.deepEqual(subject.published, []);
	});

	it("does not dispatch when no row exists for the user", async () => {
		const subject = buildSubject();
		await subject.handler(buildSqsEvent([{ messageId: "msg-none", body: buildBody(USER_ID) }]), {} as never, () => {});
		assert.deepEqual(subject.published, []);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const subject = buildSubject();
		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "not-json" }]),
			{} as never,
			() => {},
		);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("reports a batch item failure when a non-Error value is thrown (covers String(error) branch)", async () => {
		const providers = initInMemorySubscriptionProviders({
			now: () => new Date("2026-06-06T00:00:00.000Z"),
		});
		const handler = initPaymentMethodAddedHandler({
			findByUserIdConsistent: async () => {
				throw "non-error string";
			},
			publishSubscriptionStartRequestCommand: async () => {},
			logger: HutchLogger.from(noopLogger),
		});
		const result = await handler(
			buildSqsEvent([{ messageId: "msg-string-throw", body: buildBody(USER_ID) }]),
			{} as never,
			() => {},
		);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert(providers);
	});
});
