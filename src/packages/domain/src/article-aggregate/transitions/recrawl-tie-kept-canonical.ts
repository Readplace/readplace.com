import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

/* forceMarkCrawlPending unconditionally sets "pending" — without this
 * transition the row stays pending forever with canonical content on disk. */
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
