import type { Minutes } from "./article.types";

export interface DisplayableReadTime {
	value: string;
	label: string;
}

export function displayableReadTime(
	article: { metadata: { wordCount: number }; estimatedReadTime: Minutes },
): DisplayableReadTime | undefined {
	if (article.metadata.wordCount <= 0) {
		return undefined;
	}
	return {
		value: String(article.estimatedReadTime),
		label: `~${article.estimatedReadTime} min read`,
	};
}
