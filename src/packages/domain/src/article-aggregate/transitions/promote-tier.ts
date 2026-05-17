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
	/** Hash of the new canonical readable text. Compared to the row's existing
	 * `freshness.canonicalContentHash` to gate summary regeneration — equal
	 * hashes mean the readable content is unchanged and the cached summary
	 * stays valid. */
	canonicalContentHash: string;
	/** Authenticated save: emits publish-link-saved. Absent: emits publish-anonymous-link-saved. */
	userId?: string;
}

/* Selector promotion: writes metadata + freshness + crawl=ready. The summary
 * axis is only written + regenerated when the canonical content hash actually
 * changes (lazy backfill: if the row has no prior hash, treat as changed and
 * record the new one). `canonicalChanged` continues to gate the user-facing
 * notification so a re-pick of the same tier does not re-fire link-saved. */
export function promoteTier(
	article: Article,
	input: PromoteTierInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const previousHash = article.freshness.canonicalContentHash;
	const contentChanged =
		previousHash === undefined || previousHash !== input.canonicalContentHash;

	const writes: AggregateField[] = ["metadata", "freshness", "crawl"];
	const effects: Effect[] = [];
	if (contentChanged) {
		effects.push({ kind: "generate-summary", url: article.url });
	}
	effects.push({ kind: "publish-crawl-article-completed", url: article.url });
	if (input.canonicalChanged) {
		effects.push(
			input.userId
				? { kind: "publish-link-saved", url: article.url, userId: input.userId }
				: { kind: "publish-anonymous-link-saved", url: article.url },
		);
	}

	const nextFreshness: Article["freshness"] = {
		...article.freshness,
		contentFetchedAt: input.contentFetchedAt,
		canonicalContentHash: input.canonicalContentHash,
	};

	let nextSummary: Article["summary"];
	if (contentChanged) {
		nextSummary = { kind: "pending", pendingSince: input.now };
		writes.push("summary");
	} else {
		nextSummary = article.summary;
	}

	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
		summary: nextSummary,
	};

	return { article: next, effects, writes };
}
