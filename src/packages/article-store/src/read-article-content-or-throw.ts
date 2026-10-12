import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ContentProvider, ReadArticleContent } from "@packages/provider-contracts/article-store";

export function initReadArticleContentOrThrow(deps: {
	storageProviderQueryOrder: ContentProvider[];
}): ReadArticleContent {
	return async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		for (const provider of deps.storageProviderQueryOrder) {
			const content = await provider(articleResourceUniqueId);
			if (content) return content;
		}
		return undefined;
	};
}
