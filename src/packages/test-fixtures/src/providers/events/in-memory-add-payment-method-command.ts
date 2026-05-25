import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishAddPaymentMethodCommand } from "./publish-add-payment-method-command.types";

export function initInMemoryAddPaymentMethodCommand(deps: {
	logger: HutchLogger;
}): { publishAddPaymentMethodCommand: PublishAddPaymentMethodCommand } {
	const { logger } = deps;

	const publishAddPaymentMethodCommand: PublishAddPaymentMethodCommand = async (params) => {
		logger.info("[AddPaymentMethodCommand] published (in-memory no-op)", {
			userId: params.userId,
			customerId: params.customerId,
			paymentMethodId: params.paymentMethodId,
		});
	};

	return { publishAddPaymentMethodCommand };
}
