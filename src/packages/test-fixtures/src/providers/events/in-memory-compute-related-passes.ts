import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishComputeRelatedPasses } from "@packages/provider-contracts/events";

export interface ComputeRelatedPassesRecord {
	url: string;
	userId: UserId;
}

export function initInMemoryComputeRelatedPasses(deps: {
	logger: HutchLogger;
}): {
	publishComputeRelatedPasses: PublishComputeRelatedPasses;
	publishedComputeRelatedPasses: ComputeRelatedPassesRecord[];
} {
	const { logger } = deps;
	const publishedComputeRelatedPasses: ComputeRelatedPassesRecord[] = [];

	const publishComputeRelatedPasses: PublishComputeRelatedPasses = async (params) => {
		publishedComputeRelatedPasses.push({ url: params.url, userId: params.userId });
		logger.info("[ComputeRelatedPasses] command published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishComputeRelatedPasses, publishedComputeRelatedPasses };
}
