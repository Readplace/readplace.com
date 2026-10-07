import type { ContentTier } from "@packages/article-state-types";
import type { CandidateId } from "../article/article.schema";

export interface ContentSelectionSnapshot {
	revision?: number;
	contentLocation?: string;
	candidateId?: CandidateId;
	tier?: ContentTier;
	displayUrl?: string;
	contentSourceUrl?: string;
	directContentBeforePin?: boolean;
	sourceOriginalUrl?: string;
	revokedCandidateIds?: readonly CandidateId[];
}

export function isCanonicalCandidateRevoked(selection: ContentSelectionSnapshot | undefined): boolean {
	return selection?.candidateId !== undefined && selection.revokedCandidateIds?.includes(selection.candidateId) === true;
}

export function summaryMatchesCanonical(params: { candidateId: CandidateId | undefined; summarySourceContentHash: string | undefined; canonicalContentHash: string | undefined }): boolean {
	const { candidateId, summarySourceContentHash, canonicalContentHash } = params;
	return candidateId === undefined
		? !(summarySourceContentHash !== undefined && canonicalContentHash !== undefined && summarySourceContentHash !== canonicalContentHash)
		: (canonicalContentHash !== undefined && summarySourceContentHash === canonicalContentHash);
}

export interface CanonicalCommit {
	expected: ContentSelectionSnapshot | undefined;
	contentLocation: string;
	candidateId: CandidateId;
	originalUrl: string;
	tier: ContentTier;
}

export interface SelectionExpected {
	snapshot: ContentSelectionSnapshot | undefined;
	scope?: "whole-selection" | "canonical-content";
}
