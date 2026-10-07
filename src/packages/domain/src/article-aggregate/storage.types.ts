import type { Article } from "./article.types";
import type { CanonicalCommit, SelectionExpected } from "./content-selection.types";

/* Scopes the aggregate save so concurrent inline writers on untouched axes are not clobbered. */
export type AggregateField =
	| "metadata"
	| "freshness"
	| "summary"
	| "crawl"
	| "summaryAutoHeal"
	| "readerAvailability";

export type LoadArticle = (url: string) => Promise<Article | undefined>;
export type SaveArticle = (params: {
	article: Article;
	writes: readonly AggregateField[];
	canonicalCommit?: CanonicalCommit;
	selectionExpected?: SelectionExpected;
}) => Promise<void>;

export interface ArticleStore {
	load: LoadArticle;
	save: SaveArticle;
}
