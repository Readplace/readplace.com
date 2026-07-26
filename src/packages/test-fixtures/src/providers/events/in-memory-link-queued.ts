import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishLinkQueued } from "@packages/provider-contracts/events";

export function initInMemoryLinkQueued(deps: {
	logger: HutchLogger;
}): { publishLinkQueued: PublishLinkQueued } {
	const { logger } = deps;

	const publishLinkQueued: PublishLinkQueued = async (params) => {
		logger.info("[LinkQueued] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishLinkQueued };
}
