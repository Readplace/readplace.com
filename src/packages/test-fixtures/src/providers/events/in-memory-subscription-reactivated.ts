import type { Logger } from "@packages/logger";
import type { PublishSubscriptionReactivated } from "@packages/provider-contracts/events";

export function initInMemorySubscriptionReactivated(deps: {
	logger: Logger;
}): { publishSubscriptionReactivated: PublishSubscriptionReactivated } {
	const { logger } = deps;

	const publishSubscriptionReactivated: PublishSubscriptionReactivated = async (params) => {
		logger.info("[SubscriptionReactivated] published (in-memory no-op)", {
			userId: params.userId,
			subscriptionId: params.subscriptionId,
		});
	};

	return { publishSubscriptionReactivated };
}
