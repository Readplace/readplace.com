import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishDeleteAccountCommand } from "@packages/provider-contracts/events";

export function initInMemoryDeleteAccountCommand(deps: {
	logger: HutchLogger;
}): { publishDeleteAccountCommand: PublishDeleteAccountCommand } {
	const { logger } = deps;

	const publishDeleteAccountCommand: PublishDeleteAccountCommand = async (params) => {
		logger.info("[DeleteAccountCommand] published (in-memory no-op)", {
			userId: params.userId,
		});
	};

	return { publishDeleteAccountCommand };
}
