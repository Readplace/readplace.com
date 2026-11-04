import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { isPrivateItemUrl, storedArticleBody } from "@packages/domain/article";
import type {
	ContentProvider,
	FindItemOwner,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";

export type { ContentProvider, ReadArticleContent };

export function initReadArticleContent(deps: {
	storageProviderQueryOrder: ContentProvider[];
	findItemOwner: FindItemOwner;
	logError: (message: string, error?: Error) => void;
}): ReadArticleContent {
	const { storageProviderQueryOrder, logError } = deps;

	const firstStoredHtml = async (url: string): Promise<string | undefined> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);

		for (const provider of storageProviderQueryOrder) {
			try {
				const content = await provider(articleResourceUniqueId);
				if (content) return content;
			} catch (error) {
				logError(`[ReadArticleContent] provider failed for ${url}, trying next`, error instanceof Error ? error : undefined);
			}
		}

		return undefined;
	};

	return async ({ url, viewer }) => {
		const ownerUserId = isPrivateItemUrl(url) ? await deps.findItemOwner(url) : undefined;
		return storedArticleBody({ url, html: await firstStoredHtml(url), viewer, ownerUserId });
	};
}
