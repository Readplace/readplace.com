import { z } from "zod";
import { SendTrialFeedbackEmailCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { FindSubscriptionBySubscriptionId } from "@packages/provider-contracts/subscription-providers";
import type { StripeEventHandler } from "../stripe-webhook-receiver-handler";

/** The subscription reference moved between Stripe API versions: older invoice
 * payloads carry a top-level `subscription`, newer ones nest it under
 * `parent.subscription_details.subscription`. Accept both so a Stripe-side
 * version bump on the webhook endpoint cannot silently drop the lookup. */
const InvoicePayload = z.object({
	subscription: z.string().nullish(),
	parent: z
		.object({
			subscription_details: z
				.object({ subscription: z.string().nullish() })
				.nullish(),
		})
		.nullish(),
	billing_reason: z.string().nullish(),
	next_payment_attempt: z.number().nullish(),
});

export type InvoicePaymentFailedDeps = {
	findSubscriptionBySubscriptionId: FindSubscriptionBySubscriptionId;
	publishEvent: PublishEvent;
};

export function initHandleInvoicePaymentFailed(
	deps: InvoicePaymentFailedDeps,
): StripeEventHandler {
	return async ({ stripeEvent, logger }) => {
		const invoiceId = stripeEvent.data.object.id;
		const parsed = InvoicePayload.safeParse(stripeEvent.data.object);
		if (!parsed.success) {
			logger.warn("[stripe-webhook] payment-failed invoice has an unrecognised shape — skipping", {
				invoiceId,
			});
			return;
		}
		/** Only cycle invoices get Stripe's smart retries; a failed
		 * subscription_create invoice never retries (the incomplete subscription
		 * expires instead), so the email's fix-your-card promise would be false. */
		if (parsed.data.billing_reason !== "subscription_cycle") {
			logger.info("[stripe-webhook] payment-failed invoice is not a cycle invoice — skipping email", {
				invoiceId,
				billingReason: parsed.data.billing_reason,
			});
			return;
		}
		/** null on the final dunning attempt — no retry is coming, and the
		 * customer.subscription.deleted webhook carries the end state. */
		if (!parsed.data.next_payment_attempt) {
			logger.info("[stripe-webhook] final dunning attempt failed — no retry to fix, skipping email", {
				invoiceId,
			});
			return;
		}
		const subscriptionId =
			parsed.data.subscription ?? parsed.data.parent?.subscription_details?.subscription;
		if (!subscriptionId) {
			logger.warn("[stripe-webhook] payment-failed invoice carries no subscription — skipping", {
				invoiceId,
			});
			return;
		}
		const row = await deps.findSubscriptionBySubscriptionId(subscriptionId);
		if (!row) {
			logger.warn("[stripe-webhook] no subscription row found — skipping payment-failed email", {
				invoiceId,
				subscriptionId,
			});
			return;
		}
		if (row.status !== "active") {
			logger.info("[stripe-webhook] payment-failed for a non-active row — skipping email", {
				userId: row.userId,
				subscriptionId,
				status: row.status,
			});
			return;
		}
		await deps.publishEvent(SendTrialFeedbackEmailCommand, {
			userId: row.userId,
			kind: "payment_failed",
		});
		logger.info("[stripe-webhook] dispatched payment-failed email command", {
			userId: row.userId,
			invoiceId,
			subscriptionId,
		});
	};
}
