import type { Article, ArticleMetadata } from "../article.types";
import type { CanonicalImageUrl } from "../canonical-image-url";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface PromoteTierInput {
	tier: "tier-0" | "tier-1";
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

/* Selector promotion: writes metadata + freshness + crawl=ready and records the
 * new canonical hash. It no longer touches the summary axis — instead it
 * announces `publish-canonical-content-changed` whenever the canonical tier
 * flipped OR the readable text changed (lazy backfill: a row with no prior hash
 * counts as changed). The `canonical-content-changed` subscriber owns summary
 * regeneration, so future derived-artifact consumers attach without editing this
 * transition (OCP). `canonicalChanged` still gates the user-facing notification
 * so a re-pick of the same tier does not re-fire link-saved. */
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
	if (input.canonicalChanged || contentChanged) {
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
		...article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
	};

	return { article: next, effects, writes };
}
