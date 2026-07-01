import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RequestRecrawlInput {
	now: string;
}

/**
 * Operator-initiated recrawl.
 *
 * Sets `freshness.contentFetchedAt` to the epoch so the next stale-check
 * treats the row as expired; the standard refresh pipeline picks it up,
 * re-fetches, re-selects the canonical tier, and regenerates the summary.
 * There is no parallel recrawl pipeline — the standard flow is the recovery
 * affordance.
 *
 * `summaryAutoHeal` is reset so a summary that has exhausted its retry
 * budget gets a fresh one when the new content lands.
 *
 * Not idempotent by design: the operator is asking for the row to be
 * reprocessed from scratch.
 */
export function requestRecrawl(
	article: Article,
	input: RequestRecrawlInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		freshness: {
			...article.freshness,
			contentFetchedAt: new Date(0).toISOString(),
		},
		crawl: { kind: "pending", pendingSince: input.now },
		summary: { kind: "pending", pendingSince: input.now },
		summaryAutoHeal: { attempts: 0 },
	};
	return {
		article: next,
		effects: [{ kind: "dispatch-submit-link", url: article.url }],
		writes: ["freshness", "crawl", "summary", "summaryAutoHeal"],
	};
}
