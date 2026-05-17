import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkSummaryReadyInput {
	summary: string;
	excerpt: string;
	inputTokens: number;
	outputTokens: number;
	/** Optional: hash of the canonical readable text the summary was generated
	 * against. Recorded on the ready summary so a future caller can detect
	 * "content unchanged since last summary" and skip regeneration. */
	sourceContentHash?: string;
}

/* `writes` covers summary + summaryAutoHeal so a successful regen resets the
 * auto-heal counter — a future failure starts with the full retry budget. */
export function markSummaryReady(
	article: Article,
	input: MarkSummaryReadyInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const summary: Extract<Article["summary"], { kind: "ready" }> = {
		kind: "ready",
		summary: input.summary,
		excerpt: input.excerpt,
	};
	if (input.sourceContentHash !== undefined) {
		summary.sourceContentHash = input.sourceContentHash;
	}
	const next: Article = {
		...article,
		summary,
		summaryAutoHeal: { attempts: 0 },
	};
	const effects: readonly Effect[] = [
		{
			kind: "publish-summary-generated",
			url: article.url,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
		},
	];
	const writes: readonly AggregateField[] = ["summary", "summaryAutoHeal"];
	return { article: next, effects, writes };
}
