import { type SaveAttemptId, isWrapperUrl } from "@packages/domain/article";
import { LEGACY_DIRECT_CANONICAL_ATTEMPT_ID, type VerifiedTierSource } from "@packages/tier-source";

export function canonicalSupersedes(params: {
	source: VerifiedTierSource;
	canonical: VerifiedTierSource | undefined;
	saveAttemptId: SaveAttemptId;
}): boolean {
	const { source, canonical, saveAttemptId } = params;
	return canonical !== undefined
		&& canonical.metadata.attemptId !== LEGACY_DIRECT_CANONICAL_ATTEMPT_ID
		&& canonical.metadata.attemptId !== saveAttemptId
		&& canonical.tier !== "tier-2"
		&& !isWrapperUrl(canonical.metadata.sourceUrl)
		&& Date.parse(source.metadata.fetchedAt) < Date.parse(canonical.metadata.fetchedAt);
}
