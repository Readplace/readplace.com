import type { Logger } from "@packages/logger";
import type { PublishRefreshArticleContent } from "@packages/provider-contracts/events";

export function initInMemoryRefreshArticleContent(deps: {
	logger: Logger;
}): { publishRefreshArticleContent: PublishRefreshArticleContent } {
	const { logger } = deps;

	const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
		logger.info("[RefreshArticleContent] event published (in-memory no-op)", {
			url: params.url,
		});
	};

	return { publishRefreshArticleContent };
}
