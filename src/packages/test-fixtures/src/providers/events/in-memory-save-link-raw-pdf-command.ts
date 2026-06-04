import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishSaveLinkRawPdfCommand } from "./publish-save-link-raw-pdf-command.types";

export function initInMemorySaveLinkRawPdfCommand(deps: {
	logger: HutchLogger;
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
