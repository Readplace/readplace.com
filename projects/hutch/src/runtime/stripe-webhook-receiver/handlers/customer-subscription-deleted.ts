import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { FindSubscriptionBySubscriptionId } from "@packages/test-fixtures/providers/subscription-providers";
import type { StripeEventHandler } from "../stripe-webhook-receiver-handler";

export type CustomerSubscriptionDeletedDeps = {
	findSubscriptionBySubscriptionId: FindSubscriptionBySubscriptionId;
	publishEvent: PublishEvent;
};

export function initHandleCustomerSubscriptionDeleted(
	deps: CustomerSubscriptionDeletedDeps,
): StripeEventHandler {
	return async ({ stripeEvent, logger }) => {
		const subscriptionId = stripeEvent.data.object.id;
		const row = await deps.findSubscriptionBySubscriptionId(subscriptionId);
		if (!row) {
			logger.warn("[stripe-webhook] no subscription row found — skipping event emission", {
				subscriptionId,
			});
			return;
		}
		await deps.publishEvent(SubscriptionCancelledEvent, {
			userId: row.userId,
			subscriptionId,
			reason: "stripe_webhook",
		});
		logger.info("[stripe-webhook] emitted SubscriptionCancelled", {
			userId: row.userId,
			subscriptionId,
		});
	};
}
