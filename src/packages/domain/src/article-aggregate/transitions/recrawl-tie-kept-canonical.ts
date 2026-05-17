import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

/* Tie kept canonical: the selector returned a tie and a canonical already
 * exists on disk. No tier flip, no metadata refresh, no summary reset. The
 * crawl axis flips to ready to unstick the row, and no generate-summary
 * effect is emitted — re-summarising identical canonical content would
 * burn DeepSeek tokens for no value. */
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
		{ kind: "publish-recrawl-completed", url: article.url },
	];
	const writes: readonly AggregateField[] = ["crawl"];
	return { article: next, effects, writes };
}
