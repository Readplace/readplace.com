import type { Article } from "./article.types";
import type { AggregateField } from "./storage.types";

export function stampReaderAvailability(params: {
	article: Article;
	nextCrawl: Article["crawl"];
	now: string;
}): { article: Article; writes: readonly AggregateField[] } {
	const { article, nextCrawl, now } = params;
	if (
		article.readerAvailableAt !== undefined ||
		article.crawl.kind === "ready" ||
		nextCrawl.kind !== "ready"
	) {
		return { article, writes: [] };
	}
	return {
		article: { ...article, readerAvailableAt: now },
		writes: ["readerAvailability"],
	};
}
