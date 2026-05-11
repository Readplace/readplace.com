import type { Article } from "./article.types";

/**
 * Aggregate-owned field groups. A transition declares which groups it mutates
 * so the storage adapter can scope its UpdateExpression and avoid clobbering
 * concurrent inline writers on fields the transition did NOT touch.
 *
 * Phase 2 introduces crawl-state writers on the aggregate (markCrawlExhausted,
 * recrawl transitions). Without this scope hint, the unconditional whole-row
 * save would write `crawlStatus` back from the article snapshot — including on
 * a refreshContent that only touches metadata/freshness/summary — and could
 * race a concurrent inline `markCrawlFailed`/`markCrawlReady` into an
 * inconsistent state.
 */
export type AggregateField = "metadata" | "freshness" | "summary" | "crawl";

/**
 * Storage adapter contract for the Article aggregate.
 *
 * `save` is an unconditional whole-row write — Phase 1 accepts last-writer-wins
 * on concurrent updates because the row is < 8 KB and only one workflow writes
 * per URL per second in practice. Adding optimistic concurrency would mean
 * reading a `version` attribute and re-writing under a ConditionExpression;
 * we defer that until a measured conflict rate justifies the complexity.
 *
 * `transitionName` is the name of the transition function that produced this
 * article. The storage adapter persists it as a row attribute so the
 * `@packages/check-stuck-articles` canary can attribute a stuck row back to
 * the specific aggregate writer that last touched it — the Phase 2
 * falsifiable-measurement loop.
 */
export type LoadArticle = (url: string) => Promise<Article | undefined>;
export type SaveArticle = (params: {
	article: Article;
	transitionName: string;
	writes: readonly AggregateField[];
}) => Promise<void>;

export interface ArticleStore {
	load: LoadArticle;
	save: SaveArticle;
}
