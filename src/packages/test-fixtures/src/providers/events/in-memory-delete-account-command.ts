import type { Logger } from "@packages/logger";
import type { PublishDeleteAccountCommand } from "@packages/provider-contracts/events";

export function initInMemoryDeleteAccountCommand(deps: {
	logger: Logger;
}): { publishDeleteAccountCommand: PublishDeleteAccountCommand } {
	const { logger } = deps;

	const publishDeleteAccountCommand: PublishDeleteAccountCommand = async (params) => {
		logger.info("[DeleteAccountCommand] published (in-memory no-op)", {
			userId: params.userId,
		});
	};

	return { publishDeleteAccountCommand };
}
