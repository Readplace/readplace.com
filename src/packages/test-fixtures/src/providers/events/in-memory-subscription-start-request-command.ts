import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSubscriptionStartRequestCommand } from "./publish-subscription-start-request-command.types";

export function initInMemorySubscriptionStartRequestCommand(deps: {
	logger: HutchLogger;
}): { publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand } {
	const { logger } = deps;

	const publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand = async (
		params,
	) => {
		logger.info("[SubscriptionStartRequestCommand] published (in-memory no-op)", {
			userId: params.userId,
		});
	};

	return { publishSubscriptionStartRequestCommand };
}
