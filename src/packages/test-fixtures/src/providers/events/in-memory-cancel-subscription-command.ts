import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishCancelSubscriptionCommand } from "./publish-cancel-subscription-command.types";

export function initInMemoryCancelSubscriptionCommand(deps: {
	logger: HutchLogger;
}): { publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand } {
	const { logger } = deps;

	const publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand = async (params) => {
		logger.info("[CancelSubscriptionCommand] published (in-memory no-op)", {
			userId: params.userId,
		});
	};

	return { publishCancelSubscriptionCommand };
}
