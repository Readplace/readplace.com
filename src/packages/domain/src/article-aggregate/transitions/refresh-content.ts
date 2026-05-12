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

/* `writes` excludes "crawl" — a concurrent inline crawl writer must not be
 * clobbered by the refresh aggregate save when the crawl is still in flight. */
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
