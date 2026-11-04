import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { isPrivateItemUrl, storedArticleBody } from "@packages/domain/article";
import type { ContentProvider, FindItemOwner, ReadArticleContent } from "@packages/provider-contracts/article-store";

export function initReadArticleContentOrThrow(deps: {
	storageProviderQueryOrder: ContentProvider[];
	findItemOwner: FindItemOwner;
}): ReadArticleContent {
	const firstStoredHtml = async (url: string): Promise<string | undefined> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		for (const provider of deps.storageProviderQueryOrder) {
			const content = await provider(articleResourceUniqueId);
			if (content) return content;
		}
		return undefined;
	};

	return async ({ url, viewer }) => {
		const ownerUserId = isPrivateItemUrl(url) ? await deps.findItemOwner(url) : undefined;
		return storedArticleBody({ url, html: await firstStoredHtml(url), viewer, ownerUserId });
	};
}
