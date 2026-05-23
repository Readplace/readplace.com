import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionCancelled } from "./publish-subscription-cancelled.types";

export function initInMemorySubscriptionCancelled(deps: {
	logger: HutchLogger;
}): { publishSubscriptionCancelled: PublishSubscriptionCancelled } {
	const { logger } = deps;

	const publishSubscriptionCancelled: PublishSubscriptionCancelled = async (params) => {
		logger.info("[SubscriptionCancelled] published (in-memory no-op)", {
			userId: params.userId,
			subscriptionId: params.subscriptionId,
			reason: params.reason,
		});
	};

	return { publishSubscriptionCancelled };
}
