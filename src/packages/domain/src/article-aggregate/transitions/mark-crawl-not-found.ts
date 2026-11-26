import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";
import { failCrawlAndSkipSummary } from "./fail-crawl-and-skip-summary";

export interface MarkCrawlNotFoundInput {
	reason: Extract<CrawlFailureReason, { kind: "not-found" }>;
}

export function markCrawlNotFound(
	article: Article,
	input: MarkCrawlNotFoundInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	/* A tier-1 not-found verdict can be stale: another writer (e.g. a tier-0
	 * extension save carrying the user's own session-rendered content) may have
	 * already driven the row to crawl=ready. Single writer per terminal state:
	 * markCrawlNotFound only asserts crawl=failed over a not-yet-ready row. */
	return failCrawlAndSkipSummary(article, input.reason);
}
