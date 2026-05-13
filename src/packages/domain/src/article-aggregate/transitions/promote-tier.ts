import type { Article, ArticleMetadata } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface PromoteTierInput {
	tier: "tier-0" | "tier-1";
	metadata: ArticleMetadata;
	estimatedReadTime: number;
	contentFetchedAt: string;
	now: string;
	/** True when the canonical tier flipped this run; gates the publish-link-saved / publish-anonymous-link-saved effect so a re-pick of the same tier does not re-fire user-facing notifications. */
	canonicalChanged: boolean;
	/** Authenticated save: emits publish-link-saved. Absent: emits publish-anonymous-link-saved. */
	userId?: string;
}

/* Selector promotion: writes metadata + freshness + crawl=ready + summary=pending.
 * `canonicalChanged` gates the user-facing event so a re-pick of the same tier
 * does not re-fire link-saved / anonymous-link-saved notifications. */
export function promoteTier(
	article: Article,
	input: PromoteTierInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: { ...article.freshness, contentFetchedAt: input.contentFetchedAt },
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: input.now },
	};
	const effects: Effect[] = [
		{ kind: "generate-summary", url: article.url },
		{ kind: "publish-crawl-article-completed", url: article.url },
	];
	if (input.canonicalChanged) {
		effects.push(
			input.userId
				? { kind: "publish-link-saved", url: article.url, userId: input.userId }
				: { kind: "publish-anonymous-link-saved", url: article.url },
		);
	}
	const writes: readonly AggregateField[] = [
		"metadata",
		"freshness",
		"crawl",
		"summary",
	];
	return { article: next, effects, writes };
}
