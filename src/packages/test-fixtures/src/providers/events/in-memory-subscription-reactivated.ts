import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionReactivated } from "./publish-subscription-reactivated.types";

export function initInMemorySubscriptionReactivated(deps: {
	logger: HutchLogger;
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
