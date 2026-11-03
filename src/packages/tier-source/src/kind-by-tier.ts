import type { CandidateProvenance, Tier } from "./tier-source.types";

export const KIND_BY_TIER: Record<Tier, CandidateProvenance["kind"]> = { "tier-0": "extension", "tier-1": "live", "tier-2": "wrapper" };
