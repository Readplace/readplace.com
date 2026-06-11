import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionChargeFailed } from "@packages/provider-contracts/events";

export function initInMemorySubscriptionChargeFailed(deps: {
	logger: HutchLogger;
}): { publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed } {
	const { logger } = deps;

	const publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed = async (params) => {
		logger.info("[SubscriptionChargeFailed] published (in-memory no-op)", {
			userId: params.userId,
			reason: params.reason,
		});
	};

	return { publishSubscriptionChargeFailed };
}
