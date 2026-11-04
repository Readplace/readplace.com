import type { Logger } from "@packages/logger";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";

export function initInMemoryExportUserDataCommand(deps: {
	logger: Logger;
}): { publishExportUserDataCommand: PublishExportUserDataCommand } {
	const { logger } = deps;

	const publishExportUserDataCommand: PublishExportUserDataCommand = async (params) => {
		logger.info("[ExportUserDataCommand] published (in-memory no-op)", {
			userId: params.userId,
			email: params.email,
			requestedAt: params.requestedAt,
		});
	};

	return { publishExportUserDataCommand };
}
