import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import type { PublishComputeRelatedArticles } from "@packages/provider-contracts/events";

export interface ComputeRelatedArticlesCommandRecord {
	url: string;
	userId: UserId;
}

export function initInMemoryComputeRelatedArticles(deps: {
	logger: HutchLogger;
}): {
	publishComputeRelatedArticles: PublishComputeRelatedArticles;
	publishedComputeRelatedArticles: ComputeRelatedArticlesCommandRecord[];
} {
	const { logger } = deps;
	const publishedComputeRelatedArticles: ComputeRelatedArticlesCommandRecord[] = [];

	const publishComputeRelatedArticles: PublishComputeRelatedArticles = async (
		params,
	) => {
		publishedComputeRelatedArticles.push({
			url: params.url,
			userId: params.userId,
		});
		logger.info(
			"[ComputeRelatedArticles] command published (in-memory no-op)",
			{ url: params.url, userId: params.userId },
		);
	};

	return { publishComputeRelatedArticles, publishedComputeRelatedArticles };
}
