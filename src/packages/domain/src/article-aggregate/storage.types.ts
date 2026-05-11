import type { Article } from "./article.types";

/**
 * Storage adapter contract for the Article aggregate.
 *
 * `save` is an unconditional whole-row write — Phase 1 accepts last-writer-wins
 * on concurrent updates because the row is < 8 KB and only one workflow writes
 * per URL per second in practice. Adding optimistic concurrency would mean
 * reading a `version` attribute and re-writing under a ConditionExpression;
 * we defer that until a measured conflict rate justifies the complexity.
 */
export type LoadArticle = (url: string) => Promise<Article | undefined>;
export type SaveArticle = (article: Article) => Promise<void>;

export interface ArticleStore {
	load: LoadArticle;
	save: SaveArticle;
}
