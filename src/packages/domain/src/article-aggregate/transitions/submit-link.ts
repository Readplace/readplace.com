import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface SubmitLinkInput {
	url: string;
	userId?: string;
	rawHtml?: string;
	now: string;
}

/**
 * Entry-point upsert transition for user / anonymous / extension saves.
 *
 * First save: synthesises a hostname-only pending stub so the queue card
 * renders immediately at t=0 while the crawler fills in title / excerpt /
 * content asynchronously.
 *
 * Subsequent saves (`pending` or any terminal state): the row is left
 * untouched and the `dispatch-submit-link` effect re-fires. Re-firing on a
 * stuck `pending` is how the system self-heals when an earlier dispatch was
 * dropped. Re-firing on a terminal row is a no-op at the receiver — the
 * submit-link handler will short-circuit on `crawl.kind === "ready"`.
 * Operators flip a terminal row back to `pending` via `requestRecrawl`, not
 * via this transition.
 */
export function submitLink(
	article: Article | undefined,
	input: SubmitLinkInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const effects: readonly Effect[] = [
		{
			kind: "dispatch-submit-link",
			url: input.url,
			...(input.userId !== undefined ? { userId: input.userId } : {}),
			...(input.rawHtml !== undefined ? { rawHtml: input.rawHtml } : {}),
		},
	];

	if (article === undefined) {
		return {
			article: synthesiseStub(input),
			effects,
			writes: ["crawl", "summary", "metadata", "freshness"],
		};
	}

	return { article, effects, writes: [] };
}

function synthesiseStub(input: SubmitLinkInput): Article {
	const hostname = new URL(input.url).hostname;
	return {
		url: input.url,
		metadata: {
			title: `Article from ${hostname}`,
			siteName: hostname,
			excerpt: `Saved from ${hostname}.`,
			wordCount: 0,
		},
		freshness: { contentFetchedAt: input.now },
		estimatedReadTime: 0,
		crawl: { kind: "pending", pendingSince: input.now },
		summary: { kind: "pending", pendingSince: input.now },
		summaryAutoHeal: { attempts: 0 },
	};
}
