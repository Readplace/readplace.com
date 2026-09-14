import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishComputeRelatedPastReads } from "@packages/provider-contracts/events";

export interface ComputeRelatedPastReadsRecord {
	url: string;
	userId: UserId;
	readlist?: string;
}

export function initInMemoryComputeRelatedPastReads(deps: {
	logger: HutchLogger;
}): {
	publishComputeRelatedPastReads: PublishComputeRelatedPastReads;
	publishedComputeRelatedPastReads: ComputeRelatedPastReadsRecord[];
} {
	const { logger } = deps;
	const publishedComputeRelatedPastReads: ComputeRelatedPastReadsRecord[] = [];

	const publishComputeRelatedPastReads: PublishComputeRelatedPastReads = async (
		params,
	) => {
		publishedComputeRelatedPastReads.push({
			url: params.url,
			userId: params.userId,
			...(params.readlist !== undefined ? { readlist: params.readlist } : {}),
		});
		logger.info("[ComputeRelatedPastReads] command published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
		});
	};

	return { publishComputeRelatedPastReads, publishedComputeRelatedPastReads };
}
