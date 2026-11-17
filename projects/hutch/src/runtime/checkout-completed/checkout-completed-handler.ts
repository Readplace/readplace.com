import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { CheckoutCompletedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ActivateCheckout } from "../domain/subscription/activate-checkout";

export function initCheckoutCompletedHandler(deps: {
	activateCheckout: ActivateCheckout;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: CheckoutCompletedEvent,
		logger: deps.logger,
		failure: { message: "[checkout-completed] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { time: eventTime } = EventEnvelope.parse(JSON.parse(record.body));
			const activation = await deps.activateCheckout({
				checkoutSessionId: detail.checkoutSessionId,
				subscriptionId: detail.subscriptionId,
				customerId: detail.customerId,
				amountTotal: detail.amountTotal,
				activatedBy: "webhook",
				eventTime,
			});
			if (activation.outcome === "not-found") {
				deps.logger.warn("[checkout-completed] no pending signup for a completed checkout — nothing to activate", {
					checkoutSessionId: detail.checkoutSessionId,
					subscriptionId: detail.subscriptionId,
				});
				return;
			}
			if (activation.outcome === "predates-status") {
				deps.logger.warn("[checkout-completed] message predates row status — noop; the reader paid in Stripe, so check the Stripe subscription by hand", {
					checkoutSessionId: detail.checkoutSessionId,
					subscriptionId: detail.subscriptionId,
					eventTime,
				});
				return;
			}
			deps.logger.info(`[checkout-completed] ${activation.outcome}`, {
				checkoutSessionId: detail.checkoutSessionId,
				subscriptionId: detail.subscriptionId,
			});
		},
	});
}
