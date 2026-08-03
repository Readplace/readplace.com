import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";

export function initInMemoryLinkDequeued(deps: {
	logger: HutchLogger;
}): { publishLinkDequeued: PublishLinkDequeued } {
	const { logger } = deps;

	const publishLinkDequeued: PublishLinkDequeued = async (params) => {
		logger.info("[LinkDequeued] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishLinkDequeued };
}
