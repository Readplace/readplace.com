import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkSummaryReadyInput {
	summary: string;
	excerpt: string;
	inputTokens: number;
	outputTokens: number;
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
	const next: Article = {
		...article,
		summary: {
			kind: "ready",
			summary: input.summary,
			excerpt: input.excerpt,
		},
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
