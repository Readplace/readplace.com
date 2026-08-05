import type { PublishComputeRelatedArticles } from "@packages/provider-contracts/events";
import type { SaveArticleFromUrl } from "./save-article-from-url";

export interface SaveArticleInteractivelyDependencies {
	saveArticleFromUrl: SaveArticleFromUrl;
	publishComputeRelatedArticles: PublishComputeRelatedArticles;
}

export function initSaveArticleInteractively(
	deps: SaveArticleInteractivelyDependencies,
): SaveArticleFromUrl {
	return async (params) => {
		const result = await deps.saveArticleFromUrl(params);
		if (result.createdUserArticle) {
			await deps.publishComputeRelatedArticles({
				url: result.canonicalUrl,
				userId: params.userId,
			});
		}
		return result;
	};
}
