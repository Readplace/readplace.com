import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

/* Tie kept canonical: the selector returned a tie and a canonical already
 * exists on disk. No tier flip, no metadata refresh, no summary reset — but
 * crawl still flips to ready and generate-summary still fires (the summariser
 * short-circuits on cache hit) so the row exits pending. */
export function recrawlTieKeptCanonical(
	article: Article,
	_input: undefined,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		crawl: { kind: "ready" },
	};
	const effects: readonly Effect[] = [
		{ kind: "generate-summary", url: article.url },
		{ kind: "publish-recrawl-completed", url: article.url },
	];
	const writes: readonly AggregateField[] = ["crawl"];
	return { article: next, effects, writes };
}
