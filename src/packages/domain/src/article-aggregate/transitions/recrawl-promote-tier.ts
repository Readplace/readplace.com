import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RecrawlPromoteTierInput {
	winnerTier: "tier-0" | "tier-1";
}

/**
 * The recrawl selector promoted one tier to canonical. The S3 CopyObject
 * + DynamoDB canonical metadata write live outside the aggregate (the
 * promote-tier-to-canonical adapter owns those reads); this transition flips
 * the crawl row to ready and emits the post-recrawl effects.
 *
 * `winnerTier` is captured on input so a future change that needs to vary
 * the effects by tier (e.g., different summary prompt per tier) has a place
 * to add it without re-shaping the call sites. Sibling to
 * `recrawlTieKeptCanonical`: the two paths produce the same aggregate state
 * (`crawl: ready`) and the same effects, but they exist as separate
 * transitions so reviewers can grep the call sites by intent.
 */
export function recrawlPromoteTier(
	article: Article,
	_input: RecrawlPromoteTierInput,
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
