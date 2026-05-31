import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkSummaryPendingInput {
	now: string;
}

/**
 * Re-prime the summary axis to `pending` and dispatch a fresh
 * GenerateSummaryCommand. This is the invalidation the `CanonicalContentChanged`
 * subscriber applies so the generate-summary worker stops cache-hitting a
 * terminal `ready`/`skipped` row and regenerates against the new canonical
 * content.
 *
 * Idempotent on `pendingSince`: a row already `pending` keeps its original
 * stamp — re-stamping would reset the summary SLO age-gate that watches how long
 * a summary has sat pending. From any terminal state the stamp is `now`.
 *
 * `writes` scopes to summary so a concurrent crawl-axis writer is not clobbered.
 */
export function markSummaryPending(
	article: Article,
	input: MarkSummaryPendingInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const pendingSince =
		article.summary.kind === "pending"
			? article.summary.pendingSince
			: input.now;
	const next: Article = {
		...article,
		summary: { kind: "pending", pendingSince },
	};
	const effects: readonly Effect[] = [
		{ kind: "generate-summary", url: article.url },
	];
	const writes: readonly AggregateField[] = ["summary"];
	return { article: next, effects, writes };
}
