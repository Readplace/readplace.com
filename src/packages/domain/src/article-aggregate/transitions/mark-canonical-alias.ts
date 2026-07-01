import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCanonicalAliasInput {
	canonicalUrl: string;
}

/* Turns the as-entered row into a terminal alias pointing at the canonical row
 * (whose key holds the real content). crawl=ready evades the stuck-articles
 * canary and summary=skipped evades the failed-articles canary, so the alias is
 * invisible to both. effects is empty on purpose: the alias row is never
 * rendered — every reader entry point follows the pointer — so it must not emit
 * the reader-view-succeeded notification markSummarySkipped would. */
export function markCanonicalAlias(
	article: Article,
	input: MarkCanonicalAliasInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		canonicalUrl: input.canonicalUrl,
		crawl: { kind: "ready" },
		summary: { kind: "skipped", reason: "canonical-alias" },
	};
	return { article: next, effects: [], writes: ["crawl", "summary", "canonicalUrl"] };
}
