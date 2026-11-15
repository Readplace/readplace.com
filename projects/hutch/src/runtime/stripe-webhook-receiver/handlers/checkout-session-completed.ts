import assert from "node:assert";
import { z } from "zod";
import { CheckoutCompletedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { StripeEventHandler } from "../stripe-webhook-receiver-handler";

const CheckoutSessionPayload = z.object({
	id: z.string(),
	mode: z.string(),
	status: z.string(),
	payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
	subscription: z.string().nullish(),
	customer: z.string().nullish(),
	amount_total: z.number().nullable(),
});

export function initHandleCheckoutSessionCompleted(deps: {
	publishEvent: PublishEvent;
}): StripeEventHandler {
	return async ({ stripeEvent, logger }) => {
		const session = CheckoutSessionPayload.parse(stripeEvent.data.object);
		if (session.mode !== "subscription" || session.status !== "complete" || session.payment_status === "unpaid") {
			logger.info("[stripe-webhook] checkout session is not a completed subscription checkout — skipping", {
				checkoutSessionId: session.id,
				mode: session.mode,
				status: session.status,
				paymentStatus: session.payment_status,
			});
			return;
		}
		assert(session.subscription, "a completed subscription checkout must carry a subscription id");
		assert(session.customer, "a completed subscription checkout must carry a customer id");
		await deps.publishEvent(CheckoutCompletedEvent, {
			checkoutSessionId: session.id,
			subscriptionId: session.subscription,
			customerId: session.customer,
			amountTotal: session.amount_total ?? 0,
		});
		logger.info("[stripe-webhook] emitted CheckoutCompleted", {
			checkoutSessionId: session.id,
			subscriptionId: session.subscription,
		});
	};
}
