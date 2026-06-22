import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishRefreshArticleContent } from "@packages/provider-contracts/events";

export function initInMemoryRefreshArticleContent(deps: {
	logger: HutchLogger;
}): { publishRefreshArticleContent: PublishRefreshArticleContent } {
	const { logger } = deps;

	const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
		logger.info("[RefreshArticleContent] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishRefreshArticleContent };
}
