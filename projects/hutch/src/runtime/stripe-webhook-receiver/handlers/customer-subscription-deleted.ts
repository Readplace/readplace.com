import { z } from "zod";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { FindSubscriptionBySubscriptionId } from "@packages/provider-contracts/subscription-providers";
import type { StripeEventHandler } from "../stripe-webhook-receiver-handler";

const CancellationDetails = z.object({
	cancellation_details: z
		.object({ reason: z.string().nullish() })
		.nullish(),
});

function cancelReason(
	object: Record<string, unknown>,
): "stripe_webhook" | "stripe_payment_failure" {
	const parsed = CancellationDetails.safeParse(object);
	return parsed.success && parsed.data.cancellation_details?.reason === "payment_failure"
		? "stripe_payment_failure"
		: "stripe_webhook";
}

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
		const reason = cancelReason(stripeEvent.data.object);
		await deps.publishEvent(SubscriptionCancelledEvent, {
			userId: row.userId,
			subscriptionId,
			reason,
		});
		logger.info("[stripe-webhook] emitted SubscriptionCancelled", {
			userId: row.userId,
			subscriptionId,
			reason,
		});
	};
}
