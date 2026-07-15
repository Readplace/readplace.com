import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionProviderRow, toRecord } from "./subscription-provider-row";

const USER_ID = UserIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

describe("toRecord", () => {
	it("maps a full row to a record, preserving every optional field", () => {
		const nextCharge = {
			at: "2026-08-12T10:00:00.000Z",
			amountMinor: 4900,
			currency: "usd",
		};
		const row = SubscriptionProviderRow.parse({
			userId: USER_ID,
			provider: "stripe",
			subscriptionId: "sub_1",
			customerId: "cus_1",
			status: "pending_cancellation",
			trialEndsAt: "2026-06-05T00:00:00.000Z",
			cancellationEffectiveAt: "2026-06-22T00:00:00.000Z",
			trialFeedbackEmailSentAt: "2026-06-04T00:00:00.000Z",
			trialReminderEmailSentAt: "2026-06-03T00:00:00.000Z",
			nextCharge,
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-22T10:00:00.000Z",
		});

		assert.deepEqual(toRecord(row), {
			userId: USER_ID,
			provider: "stripe",
			subscriptionId: "sub_1",
			customerId: "cus_1",
			status: "pending_cancellation",
			trialEndsAt: "2026-06-05T00:00:00.000Z",
			cancellationEffectiveAt: "2026-06-22T00:00:00.000Z",
			trialFeedbackEmailSentAt: "2026-06-04T00:00:00.000Z",
			trialReminderEmailSentAt: "2026-06-03T00:00:00.000Z",
			nextCharge,
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-22T10:00:00.000Z",
		});
	});

	it("degrades a corrupt stored nextCharge to undefined rather than throwing out of the save gate", () => {
		const row = SubscriptionProviderRow.parse({
			userId: USER_ID,
			provider: "stripe",
			status: "active",
			subscriptionId: "sub_1",
			customerId: "cus_1",
			nextCharge: { at: "2026-08-12T10:00:00.000Z", amountMinor: "not-a-number" },
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-22T10:00:00.000Z",
		});

		const record = toRecord(row);

		assert.equal(record.nextCharge, undefined);
		assert.equal("nextCharge" in record, false);
	});

	it("omits absent optional fields rather than emitting undefined", () => {
		const row = SubscriptionProviderRow.parse({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			trialEndsAt: "2026-06-05T00:00:00.000Z",
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-20T10:00:00.000Z",
		});

		const record = toRecord(row);

		assert.deepEqual(record, {
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			trialEndsAt: "2026-06-05T00:00:00.000Z",
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-20T10:00:00.000Z",
		});
		assert.equal("subscriptionId" in record, false);
		assert.equal("cancellationEffectiveAt" in record, false);
		assert.equal("trialFeedbackEmailSentAt" in record, false);
		assert.equal("trialReminderEmailSentAt" in record, false);
	});

	it("maps an active row with Stripe ids and no trial date", () => {
		const row = SubscriptionProviderRow.parse({
			userId: USER_ID,
			provider: "stripe",
			status: "active",
			subscriptionId: "sub_x",
			customerId: "cus_x",
			createdAt: "2026-05-20T10:00:00.000Z",
			updatedAt: "2026-05-22T10:00:00.000Z",
		});

		const record = toRecord(row);

		assert.equal(record.subscriptionId, "sub_x");
		assert.equal(record.customerId, "cus_x");
		assert.equal("trialEndsAt" in record, false);
	});
});
