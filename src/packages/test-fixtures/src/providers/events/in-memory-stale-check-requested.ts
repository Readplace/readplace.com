import type { Logger } from "@packages/logger";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";

export function initInMemoryStaleCheckRequested(deps: {
	logger: Logger;
}): { publishStaleCheckRequested: PublishStaleCheckRequested } {
	const { logger } = deps;

	const publishStaleCheckRequested: PublishStaleCheckRequested = async (params) => {
		logger.info("[StaleCheckRequested] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishStaleCheckRequested };
}
