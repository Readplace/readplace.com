import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

/**
 * The recrawl selector decided the Deepseek tie should keep the existing
 * canonical. The canonical S3 object is unchanged, so we only need to flip
 * the crawl row back out of the "pending" state that admin/recrawl's
 * `forceMarkCrawlPending` unconditionally wrote — otherwise readers (and the
 * Tier 1+ canary) poll a forever-"pending" row whose canonical content is
 * already on disk.
 *
 * Pairing the crawl-state flip with both effects in the transition means a
 * reviewer can't ship a branch that returns early without producing a valid
 * next aggregate state — there is no early-return shape that typechecks.
 */
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
