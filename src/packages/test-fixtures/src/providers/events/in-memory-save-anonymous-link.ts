import type { Logger } from "@packages/logger";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";

export function initInMemorySaveAnonymousLink(deps: {
	logger: Logger;
}): { publishSaveAnonymousLink: PublishSaveAnonymousLink } {
	const { logger } = deps;

	const publishSaveAnonymousLink: PublishSaveAnonymousLink = async (params) => {
		logger.info("[SaveAnonymousLinkCommand] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishSaveAnonymousLink };
}
