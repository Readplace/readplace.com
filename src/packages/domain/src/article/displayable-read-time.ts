import type { SavedArticle } from "./article.types";

export interface DisplayableReadTime {
	value: string;
	label: string;
}

export function displayableReadTime(
	article: Pick<SavedArticle, "metadata" | "estimatedReadTime">,
): DisplayableReadTime | undefined {
	if (article.metadata.wordCount <= 0) {
		return undefined;
	}
	return {
		value: String(article.estimatedReadTime),
		label: `~${article.estimatedReadTime} min read`,
	};
}
