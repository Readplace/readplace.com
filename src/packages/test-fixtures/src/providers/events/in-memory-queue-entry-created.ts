import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import type { PublishQueueEntryCreated } from "@packages/provider-contracts/events";

export interface QueueEntryCreatedRecord {
	url: string;
	userId: UserId;
}

export function initInMemoryQueueEntryCreated(deps: {
	logger: HutchLogger;
}): {
	publishQueueEntryCreated: PublishQueueEntryCreated;
	publishedQueueEntryCreated: QueueEntryCreatedRecord[];
} {
	const { logger } = deps;
	const publishedQueueEntryCreated: QueueEntryCreatedRecord[] = [];

	const publishQueueEntryCreated: PublishQueueEntryCreated = async (params) => {
		publishedQueueEntryCreated.push({
			url: params.url,
			userId: params.userId,
		});
		logger.info("[QueueEntryCreated] event published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishQueueEntryCreated, publishedQueueEntryCreated };
}
