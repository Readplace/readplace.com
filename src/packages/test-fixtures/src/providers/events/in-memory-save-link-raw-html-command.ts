import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";

export function initInMemorySaveLinkRawHtmlCommand(deps: {
	logger: HutchLogger;
}): { publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand } {
	const { logger } = deps;

	const publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand = async (params) => {
		logger.info("[SaveLinkRawHtmlCommand] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishSaveLinkRawHtmlCommand };
}
