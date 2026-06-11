import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishRecrawlLinkInitiated } from "@packages/provider-contracts/events";

export function initInMemoryRecrawlLinkInitiated(deps: {
	logger: HutchLogger;
}): { publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated } {
	const { logger } = deps;

	const publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated = async (params) => {
		logger.info("[RecrawlLinkInitiated] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishRecrawlLinkInitiated };
}
