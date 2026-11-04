import type { Logger } from "@packages/logger";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";

export function initInMemoryLinkSaved(deps: {
	logger: Logger;
}): { publishLinkSaved: PublishLinkSaved } {
	const { logger } = deps;

	const publishLinkSaved: PublishLinkSaved = async (params) => {
		logger.info("[LinkSaved] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishLinkSaved };
}
