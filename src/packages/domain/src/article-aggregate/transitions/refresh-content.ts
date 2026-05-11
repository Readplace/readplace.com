import type {
	Article,
	ArticleFreshness,
	ArticleMetadata,
} from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RefreshContentInput {
	metadata: ArticleMetadata;
	freshness: ArticleFreshness;
	estimatedReadTime: number;
}

/**
 * Refresh an article's metadata + content freshness after the periodic
 * staleness check fetched new bytes. Invalidates the cached summary by
 * resetting `summary` to `pending` and emits a `generate-summary` effect.
 *
 * Returning the effect alongside the new aggregate means a writer can't
 * silently drop the regen command — the test suite asserts that
 * `refreshContent({...}).effects` contains the dispatch, so the bug from
 * 2026-05-10 (REMOVE summary attributes but no GenerateSummaryCommand
 * dispatched, leaving the row stuck on "Generating summary…") fails at
 * compile/unit time rather than as a stuck production row.
 *
 * `writes` deliberately excludes "crawl" — a concurrent inline crawl writer
 * must not be clobbered by the refresh aggregate save when the crawl is still
 * in flight.
 */
export function refreshContent(
	article: Article,
	input: RefreshContentInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: input.freshness,
		estimatedReadTime: input.estimatedReadTime,
		summary: { kind: "pending" },
	};
	const effects: readonly Effect[] = [
		{ kind: "generate-summary", url: article.url },
	];
	const writes: readonly AggregateField[] = ["metadata", "freshness", "summary"];
	return { article: next, effects, writes };
}
