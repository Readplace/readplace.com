import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ContentProvider,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";

export type { ContentProvider, ReadArticleContent };

export function initReadArticleContent(deps: {
	storageProviderQueryOrder: ContentProvider[];
	logError: (message: string, error?: Error) => void;
}): ReadArticleContent {
	const { storageProviderQueryOrder, logError } = deps;

	return async (url) => {
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
}
