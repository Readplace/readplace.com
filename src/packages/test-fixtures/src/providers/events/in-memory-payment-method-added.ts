import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishPaymentMethodAdded } from "./publish-payment-method-added.types";

export function initInMemoryPaymentMethodAdded(deps: {
	logger: HutchLogger;
}): { publishPaymentMethodAdded: PublishPaymentMethodAdded } {
	const { logger } = deps;

	const publishPaymentMethodAdded: PublishPaymentMethodAdded = async (params) => {
		logger.info("[PaymentMethodAdded] published (in-memory no-op)", {
			userId: params.userId,
		});
	};

	return { publishPaymentMethodAdded };
}
