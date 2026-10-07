import type { ContentTier } from "@packages/article-state-types";
import type { Article, ArticleMetadata } from "../article.types";
import type { CanonicalImageUrl } from "../canonical-image-url";
import type { Effect } from "../effects.types";
import { isCanonicalCandidateRevoked } from "../content-selection.types";
import { stampReaderAvailability } from "../reader-availability";
import type { AggregateField } from "../storage.types";
import { pendingSummary } from "./mark-summary-pending";

export interface PromoteTierInput {
	tier: ContentTier;
	/** `imageUrl` is branded `CanonicalImageUrl` so the only way to populate it
	 * is `resolveCanonicalImageUrl` (save-link/select-content), which rescues
	 * an og:image from a losing tier when the winner has none. Passing
	 * `winnerSource.metadata.imageUrl` directly is a compile error. */
	metadata: Omit<ArticleMetadata, "imageUrl"> & { imageUrl: CanonicalImageUrl };
	estimatedReadTime: number;
	contentFetchedAt: string;
	now: string;
	/** True when the canonical tier flipped this run; gates the publish-link-saved / publish-anonymous-link-saved effect so a re-pick of the same tier does not re-fire user-facing notifications. */
	canonicalChanged: boolean;
	/** Hash of the new canonical readable text. Compared to the row's existing
	 * `freshness.canonicalContentHash` to detect a readable-text change even when
	 * the tier did not flip — so a same-tier re-pick whose text differs still
	 * announces CanonicalContentChanged. */
	canonicalContentHash: string;
	/** Authenticated save: emits publish-link-saved. Absent: emits publish-anonymous-link-saved. */
	userId?: string;
}

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

	const available = stampReaderAvailability({
		article,
		nextCrawl: { kind: "ready" },
		now: input.now,
	});

	const writes: AggregateField[] = ["metadata", "freshness", "crawl", ...available.writes];
	const effects: Effect[] = [];
	const summaryInvalidated = input.canonicalChanged || contentChanged || isCanonicalCandidateRevoked(article.contentSelection);
	if (summaryInvalidated) {
		writes.push("summary");
		effects.push({ kind: "publish-canonical-content-changed", url: article.url });
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

	const next: Article = {
		...available.article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
		summary: summaryInvalidated ? pendingSummary(article, input.now) : article.summary,
	};

	return { article: next, effects, writes };
}
