import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionChargeSucceeded } from "./publish-subscription-charge-succeeded.types";

export function initInMemorySubscriptionChargeSucceeded(deps: {
	logger: HutchLogger;
}): { publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded } {
	const { logger } = deps;

	const publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded = async (params) => {
		logger.info("[SubscriptionChargeSucceeded] published (in-memory no-op)", {
			userId: params.userId,
			subscriptionId: params.subscriptionId,
			customerId: params.customerId,
		});
	};

	return { publishSubscriptionChargeSucceeded };
}
