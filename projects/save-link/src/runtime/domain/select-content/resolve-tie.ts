import assert from "node:assert";
import { ARCHIVE_TIER } from "@packages/article-state-types";
import type { LoadArticle } from "@packages/domain/article-aggregate";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import { tiersDifferInMedia } from "./tiers-differ-in-media";
import type { TierSource } from "./tier-source.types";
import type { Tier } from "./tier.types";

const TIE_FALLBACK_ORDER: readonly Tier[] = ["tier-1", "tier-0", ARCHIVE_TIER];

export type TieResolution =
	| { kind: "keep-canonical" }
	| { kind: "promote"; tier: TierSource["tier"]; reason: string; existingTier: TierSource["tier"] | undefined };

export type ResolveTie = (params: {
	sources: readonly TierSource[];
	freshTier: TierSource["tier"];
	url: string;
}) => Promise<TieResolution>;

export function initResolveTie(deps: {
	findContentSourceTier: FindContentSourceTier;
	loadArticle: LoadArticle;
}): ResolveTie {
	const { findContentSourceTier, loadArticle } = deps;

	return async ({ sources, freshTier, url }) => {
		const mediaChanged =
			freshTier !== ARCHIVE_TIER && tiersDifferInMedia(sources.filter((s) => s.tier !== ARCHIVE_TIER));

		if (mediaChanged) {
			assert(
				sources.some((s) => s.tier === freshTier),
				`freshly-written tier ${freshTier} missing from candidate set`,
			);
			return { kind: "promote", tier: freshTier, reason: `media changed on prose tie; promoted ${freshTier}`, existingTier: undefined };
		}

		const existingTier = await findContentSourceTier(url);
		const existingArticle = existingTier
			? await loadArticle(url)
			: undefined;
		const summaryStuckOnTooShort =
			existingArticle?.summary.kind === "skipped" &&
			existingArticle.summary.reason === "content-too-short";
		const canonicalIsHealthy = existingTier && !summaryStuckOnTooShort;

		if (canonicalIsHealthy) {
			return { kind: "keep-canonical" };
		}

		const fallbackTier = TIE_FALLBACK_ORDER.find((tier) => sources.some((s) => s.tier === tier));
		const fallback = sources.find((s) => s.tier === fallbackTier);
		assert(fallback, "tie with no candidate tiers should be unreachable");
		const reason = summaryStuckOnTooShort
			? `tie + canonical summary skipped on too-short content; promoted ${fallback.tier} to retry`
			: `tie with no canonical; defaulted to ${fallback.tier}`;
		return { kind: "promote", tier: fallback.tier, reason, existingTier };
	};
}
