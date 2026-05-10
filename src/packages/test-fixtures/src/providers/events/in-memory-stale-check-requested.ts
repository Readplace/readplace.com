import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishStaleCheckRequested } from "./publish-stale-check-requested.types";

export function initInMemoryStaleCheckRequested(deps: {
	logger: HutchLogger;
}): { publishStaleCheckRequested: PublishStaleCheckRequested } {
	const { logger } = deps;

	const publishStaleCheckRequested: PublishStaleCheckRequested = async (params) => {
		logger.info("[StaleCheckRequested] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishStaleCheckRequested };
}
