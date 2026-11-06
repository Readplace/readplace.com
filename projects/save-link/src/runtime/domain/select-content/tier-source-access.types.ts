import type { CandidateId } from "@packages/domain/article";
import type { CanonicalCommit } from "@packages/domain/article-aggregate";
import type { Tier, TierSource, VerifiedTierSource } from "@packages/tier-source";

export type ReadTierSource = (params: { url: string; tier: Tier; candidateId?: CandidateId }) => Promise<TierSource | undefined>;

export type WriteCanonicalContent = (params: { url: string; source: VerifiedTierSource }) => Promise<Omit<CanonicalCommit, "expected" | "originalUrl">>;
