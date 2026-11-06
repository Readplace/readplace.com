import type { Logger } from "@packages/logger";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";

export function initInMemoryUpdateFetchTimestamp(deps: {
	logger: Logger;
}): { publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp } {
	const { logger } = deps;

	const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = async (params) => {
		logger.info("[UpdateFetchTimestamp] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishUpdateFetchTimestamp };
}
