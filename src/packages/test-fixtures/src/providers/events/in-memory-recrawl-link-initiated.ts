import type { Logger } from "@packages/logger";
import type { PublishRecrawlLinkInitiated } from "@packages/provider-contracts/events";

export function initInMemoryRecrawlLinkInitiated(deps: {
	logger: Logger;
}): { publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated } {
	const { logger } = deps;

	const publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated = async (params) => {
		logger.info("[RecrawlLinkInitiated] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishRecrawlLinkInitiated };
}
