import { type CanonicalImageUrl, CanonicalImageUrlSchema } from "@packages/domain/article-aggregate";
import type { TierSource } from "./tier-source.types";

/**
 * The selector chooses a winning tier based on body completeness, but
 * `metadata.imageUrl` is set per tier and the tiers can disagree — tier-1
 * may have uploaded a thumbnail to the CDN while tier-0 (or a tier-1 saved
 * before og:image extraction landed) carries `undefined`. The queue card
 * and social preview just need ANY image, so promote the winner's URL when
 * present and fall back to the first non-null across the remaining
 * candidates. Decouples "which body wins" (LLM) from "which image wins"
 * (deterministic) so a tier whose body was rejected can still contribute
 * its og:image when the winner has none.
 *
 * Returns the branded `CanonicalImageUrl` so the type checker rejects any
 * promote/refresh transition that tries to short-circuit this resolver and
 * pass `winnerSource.metadata.imageUrl` directly — that's the bug shape
 * this helper exists to prevent.
 */
export function resolveCanonicalImageUrl(params: {
	winner: TierSource;
	candidates: readonly TierSource[];
}): CanonicalImageUrl {
	if (params.winner.metadata.imageUrl) {
		return CanonicalImageUrlSchema.parse(params.winner.metadata.imageUrl);
	}
	const fallback = params.candidates.find((candidate) => candidate.metadata.imageUrl);
	return CanonicalImageUrlSchema.parse(fallback?.metadata.imageUrl);
}
