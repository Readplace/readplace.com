import type { Logger } from "@packages/logger";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";

export function initInMemorySaveLinkRawPdfCommand(deps: {
	logger: Logger;
}): { publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand } {
	const { logger } = deps;

	const publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand = async (params) => {
		logger.info("[SaveLinkRawPdfCommand] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishSaveLinkRawPdfCommand };
}
