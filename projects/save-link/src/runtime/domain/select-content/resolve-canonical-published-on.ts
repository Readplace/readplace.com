import { type CanonicalPublishedOn, CanonicalPublishedOnSchema } from "@packages/domain/article-aggregate";
import type { TierSource } from "./tier-source.types";

export function resolveCanonicalPublishedOn(params: {
	winner: TierSource;
	candidates: readonly TierSource[];
}): CanonicalPublishedOn {
	if (params.winner.metadata.publishedOn) {
		return CanonicalPublishedOnSchema.parse(params.winner.metadata.publishedOn);
	}
	const fallback = params.candidates.find((candidate) => candidate.metadata.publishedOn);
	return CanonicalPublishedOnSchema.parse(fallback?.metadata.publishedOn);
}
