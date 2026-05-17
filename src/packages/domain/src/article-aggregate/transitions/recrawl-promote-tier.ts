import type { Article, ArticleMetadata } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RecrawlPromoteTierInput {
	winnerTier: "tier-0" | "tier-1";
	metadata: ArticleMetadata;
	estimatedReadTime: number;
	contentFetchedAt: string;
	now: string;
	/** Hash of the new canonical readable text. Compared to the row's existing
	 * `freshness.canonicalContentHash` to gate summary regeneration — equal
	 * hashes mean the recrawl produced identical readable content and the cached
	 * summary remains valid. */
	canonicalContentHash: string;
}

/* Recrawl promotion: writes metadata + freshness + crawl=ready. The summary
 * axis is only regenerated when the canonical content hash actually changed
 * (lazy backfill: a row without a prior hash is treated as changed). */
export function recrawlPromoteTier(
	article: Article,
	input: RecrawlPromoteTierInput,
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
	effects.push({ kind: "publish-recrawl-completed", url: article.url });

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
