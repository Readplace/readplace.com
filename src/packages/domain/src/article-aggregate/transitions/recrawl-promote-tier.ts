import type { ContentTier } from "@packages/article-state-types";
import type { Article, ArticleMetadata } from "../article.types";
import type { CanonicalImageUrl } from "../canonical-image-url";
import type { Effect } from "../effects.types";
import { stampReaderAvailability } from "../reader-availability";
import type { AggregateField } from "../storage.types";
import { pendingSummary } from "./mark-summary-pending";

export interface RecrawlPromoteTierInput {
	winnerTier: ContentTier;
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

	const available = stampReaderAvailability({
		article,
		nextCrawl: { kind: "ready" },
		now: input.now,
	});

	const effects: readonly Effect[] = [
		{ kind: "publish-canonical-content-changed", url: article.url },
		{ kind: "publish-recrawl-completed", url: article.url },
	];
	const writes: readonly AggregateField[] = [
		"metadata",
		"freshness",
		"crawl",
		"summary",
		...available.writes,
	];

	const next: Article = {
		...available.article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
		summary: pendingSummary(article, input.now),
	};

	return { article: next, effects, writes };
}
