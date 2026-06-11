import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";

export function initInMemoryUpdateFetchTimestamp(deps: {
	logger: HutchLogger;
}): { publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp } {
	const { logger } = deps;

	const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = async (params) => {
		logger.info("[UpdateFetchTimestamp] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishUpdateFetchTimestamp };
}
