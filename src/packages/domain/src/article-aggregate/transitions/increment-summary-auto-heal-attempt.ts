import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface IncrementSummaryAutoHealAttemptInput {
	now: string;
}

/**
 * Re-prime a summary axis sitting at `failed` by flipping it back to pending
 * and dispatching a fresh GenerateSummaryCommand. Increments the auto-heal
 * counter so the gate can stop trying after the configured budget; the
 * `lastAttemptAt` stamp lets the gate enforce a TTL between rounds.
 *
 * `writes` scopes to summary + summaryAutoHeal so a concurrent crawl-axis
 * writer is not clobbered.
 */
export function incrementSummaryAutoHealAttempt(
	article: Article,
	input: IncrementSummaryAutoHealAttemptInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const nextAttempts = article.summaryAutoHeal.attempts + 1;
	const next: Article = {
		...article,
		summary: { kind: "pending", pendingSince: input.now },
		summaryAutoHeal: {
			attempts: nextAttempts,
			lastAttemptAt: input.now,
		},
	};
	const effects: readonly Effect[] = [
		{
			kind: "dispatch-generate-summary-retry",
			url: article.url,
			attempt: nextAttempts,
		},
	];
	const writes: readonly AggregateField[] = ["summary", "summaryAutoHeal"];
	return { article: next, effects, writes };
}
