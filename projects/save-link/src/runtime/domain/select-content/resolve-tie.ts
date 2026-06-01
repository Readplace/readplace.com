import assert from "node:assert";
import type { LoadArticle } from "@packages/domain/article-aggregate";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import { tiersDifferInMedia } from "./tiers-differ-in-media";
import type { TierSource } from "./tier-source.types";

export type TieResolution =
	| { kind: "keep-canonical" }
	| { kind: "promote"; tier: TierSource["tier"]; reason: string };

export async function resolveTie(params: {
	sources: readonly TierSource[];
	freshTier: TierSource["tier"];
	url: string;
	findContentSourceTier: FindContentSourceTier;
	loadArticle: LoadArticle;
}): Promise<TieResolution> {
	const { sources, freshTier, url, findContentSourceTier, loadArticle } = params;

	const mediaChanged = tiersDifferInMedia(sources);

	if (mediaChanged) {
		assert(
			sources.some((s) => s.tier === freshTier),
			`freshly-written tier ${freshTier} missing from candidate set`,
		);
		return { kind: "promote", tier: freshTier, reason: `media changed on prose tie; promoted ${freshTier}` };
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

	const fallback =
		sources.find((s) => s.tier === "tier-1") ??
		sources.find((s) => s.tier === "tier-0");
	assert(fallback, "tie with no candidate tiers should be unreachable");
	const reason = summaryStuckOnTooShort
		? `tie + canonical summary skipped on too-short content; promoted ${fallback.tier} to retry`
		: `tie with no canonical; defaulted to ${fallback.tier}`;
	return { kind: "promote", tier: fallback.tier, reason };
}
