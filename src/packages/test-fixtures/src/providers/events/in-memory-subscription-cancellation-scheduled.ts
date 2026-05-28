import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionCancellationScheduled } from "./publish-subscription-cancellation-scheduled.types";

export function initInMemorySubscriptionCancellationScheduled(deps: {
	logger: HutchLogger;
}): { publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled } {
	const { logger } = deps;

	const publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled = async (
		params,
	) => {
		logger.info("[SubscriptionCancellationScheduled] published (in-memory no-op)", {
			userId: params.userId,
			subscriptionId: params.subscriptionId,
			cancellationEffectiveAt: params.cancellationEffectiveAt,
		});
	};

	return { publishSubscriptionCancellationScheduled };
}
