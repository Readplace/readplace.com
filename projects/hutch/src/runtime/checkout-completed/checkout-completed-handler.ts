import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { CheckoutCompletedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { CheckoutSessionIdSchema } from "@packages/provider-contracts/hosted-checkout";
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
		handle: async (detail) => {
			const activation = await deps.activateCheckout({
				checkoutSessionId: CheckoutSessionIdSchema.parse(detail.checkoutSessionId),
				subscriptionId: detail.subscriptionId,
				customerId: detail.customerId,
				amountTotal: detail.amountTotal,
				activatedBy: "webhook",
			});
			if (activation.outcome === "not-found") {
				deps.logger.warn("[checkout-completed] no pending signup for a completed checkout — nothing to activate", {
					checkoutSessionId: detail.checkoutSessionId,
					subscriptionId: detail.subscriptionId,
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
