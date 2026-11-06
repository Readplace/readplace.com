import type { Logger } from "@packages/logger";
import type { PublishLinkQueued } from "@packages/provider-contracts/events";

export function initInMemoryLinkQueued(deps: {
	logger: Logger;
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
