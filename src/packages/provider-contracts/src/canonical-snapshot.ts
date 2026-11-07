import type { CandidateId } from "@packages/domain/article";

export interface CanonicalSnapshot {
	canonicalContentHash: string;
	canonicalCandidateId?: CandidateId;
}

export type ReadCanonicalSnapshot = (url: string) => Promise<CanonicalSnapshot | undefined>;
