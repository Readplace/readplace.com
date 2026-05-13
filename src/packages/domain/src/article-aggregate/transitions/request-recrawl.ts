import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RequestRecrawlInput {
	now: string;
}

/**
 * Operator-initiated recrawl. Sets `contentFetchedAt` to the epoch so the next
 * stale-check treats the row as expired, then the standard refresh path
 * re-fetches and the standard selector + summary pipeline regenerates from
 * scratch. No parallel pipeline; no recrawl-specific events.
 *
 * `summaryAutoHeal` resets so a previously-exhausted summary gets full retry
 * budget. The transition is not idempotent — every operator click flips the
 * axes back to pending and re-dispatches.
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
	const effects: readonly Effect[] = [
		{ kind: "dispatch-submit-link", url: article.url },
	];
	const writes: readonly AggregateField[] = [
		"freshness",
		"crawl",
		"summary",
		"summaryAutoHeal",
	];
	return { article: next, effects, writes };
}
