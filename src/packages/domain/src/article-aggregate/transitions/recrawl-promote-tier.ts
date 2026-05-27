import type { Article, ArticleMetadata } from "../article.types";
import type { CanonicalImageUrl } from "../canonical-image-url";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RecrawlPromoteTierInput {
	winnerTier: "tier-0" | "tier-1";
	/** `imageUrl` is branded `CanonicalImageUrl` so the only way to populate it
	 * is `resolveCanonicalImageUrl` (save-link/select-content), which rescues
	 * an og:image from a losing tier when the winner has none. Passing
	 * `winnerSource.metadata.imageUrl` directly is a compile error. */
	metadata: Omit<ArticleMetadata, "imageUrl"> & { imageUrl: CanonicalImageUrl };
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
 * axis is regenerated when the canonical content hash changed (lazy backfill:
 * a row without a prior hash is treated as changed), OR when the existing
 * summary is failed(crawl-failed) — that cross-axis pairing from
 * markCrawlExhausted is stale now that the crawl succeeded. */
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

	const staleCrawlFailedSummary =
		!contentChanged &&
		article.summary.kind === "failed" &&
		article.summary.reason.kind === "crawl-failed";

	const needsSummaryReset = contentChanged || staleCrawlFailedSummary;

	const writes: AggregateField[] = ["metadata", "freshness", "crawl"];
	const effects: Effect[] = [];
	if (needsSummaryReset) {
		effects.push({ kind: "generate-summary", url: article.url });
	}
	effects.push({ kind: "publish-recrawl-completed", url: article.url });

	const nextFreshness: Article["freshness"] = {
		...article.freshness,
		contentFetchedAt: input.contentFetchedAt,
		canonicalContentHash: input.canonicalContentHash,
	};

	let nextSummary: Article["summary"];
	if (needsSummaryReset) {
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
