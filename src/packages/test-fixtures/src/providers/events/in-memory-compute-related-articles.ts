import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishComputeRelatedArticles } from "@packages/provider-contracts/events";

export function initInMemoryComputeRelatedArticles(deps: {
	logger: HutchLogger;
}): { publishComputeRelatedArticles: PublishComputeRelatedArticles } {
	const { logger } = deps;

	const publishComputeRelatedArticles: PublishComputeRelatedArticles = async (
		params,
	) => {
		logger.info(
			"[ComputeRelatedArticles] command published (in-memory no-op)",
			{ url: params.url, userId: params.userId },
		);
	};

	return { publishComputeRelatedArticles };
}
