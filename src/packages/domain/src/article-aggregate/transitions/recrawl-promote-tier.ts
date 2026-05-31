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
	/** Hash of the new canonical readable text, recorded on freshness so later
	 * non-operator paths (refresh) can compare against it. It does not gate
	 * regeneration here — an operator recrawl regenerates unconditionally. */
	canonicalContentHash: string;
}

/* Recrawl promotion: writes metadata + freshness + crawl=ready and records the
 * new canonical hash. An operator recrawl is an explicit "rebuild this" action,
 * so — unlike the automatic save path, which gates on a tier flip or hash
 * change — it announces `publish-canonical-content-changed` UNCONDITIONALLY on
 * every promotion. The `canonical-content-changed` subscriber re-primes the
 * summary, so every operator recrawl regenerates the AI excerpt regardless of
 * whether the readable text changed. Like promoteTier, this transition no
 * longer touches the summary axis itself — the subscriber owns it (OCP). */
export function recrawlPromoteTier(
	article: Article,
	input: RecrawlPromoteTierInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const nextFreshness: Article["freshness"] = {
		...article.freshness,
		contentFetchedAt: input.contentFetchedAt,
		canonicalContentHash: input.canonicalContentHash,
	};

	const effects: readonly Effect[] = [
		{ kind: "publish-canonical-content-changed", url: article.url },
		{ kind: "publish-recrawl-completed", url: article.url },
	];
	const writes: readonly AggregateField[] = ["metadata", "freshness", "crawl"];

	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
	};

	return { article: next, effects, writes };
}
