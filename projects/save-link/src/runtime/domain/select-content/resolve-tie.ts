import { type CandidateId, isWrapperUrl } from "@packages/domain/article";
import { tiersDifferInMedia } from "./tiers-differ-in-media";
import type { VerifiedTierSource } from "./tier-source.types";

export function chooseTiedCandidate(params: {
	sources: readonly VerifiedTierSource[];
	canonicalId: CandidateId | undefined;
	freshIds: ReadonlySet<CandidateId>;
	canonicalNeedsRetry: boolean;
}): VerifiedTierSource | undefined {
	const { sources, canonicalId, freshIds, canonicalNeedsRetry } = params;
	const nonArchive = sources.filter((source) => source.tier !== "tier-2" && !isWrapperUrl(source.metadata.sourceUrl));
	const live = nonArchive.filter((source) => source.tier === "tier-1");
	const canonical = sources.find((source) => source.metadata.id === canonicalId);
	const canonicalIsArchive = canonical !== undefined && !nonArchive.includes(canonical);
	if (canonicalIsArchive && live.length > 0) return live.find((source) => freshIds.has(source.metadata.id)) ?? live[0];
	if (tiersDifferInMedia(nonArchive)) {
		const fresh = nonArchive.find((source) => freshIds.has(source.metadata.id));
		if (fresh !== undefined) return fresh;
	}
	if (canonical !== undefined && !canonicalNeedsRetry && !canonicalIsArchive) return canonical;
	return live.find((source) => freshIds.has(source.metadata.id)) ?? live[0]
		?? nonArchive[0]
		?? canonical
		?? sources[0];
}
