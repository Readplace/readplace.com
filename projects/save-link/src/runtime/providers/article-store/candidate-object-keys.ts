import { createHash } from "node:crypto";
import type { CandidateId } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";

function candidatePrefix(params: { url: string; tier: Tier; candidateId: CandidateId }): string {
	const id = ArticleResourceUniqueId.parse(params.url);
	const candidateHash = createHash("sha256").update(params.candidateId).digest("hex");
	return `${id.toS3CandidatesPrefix({ tier: params.tier })}${candidateHash}`;
}

export function candidateManifestKey(params: { url: string; tier: Tier; candidateId: CandidateId }): string {
	return `${candidatePrefix(params)}/metadata.json`;
}

export function candidateBodyKeys(params: { url: string; tier: Tier; candidateId: CandidateId }): { htmlLocation: string; evaluationLocation: string } {
	const prefix = candidatePrefix(params);
	return { htmlLocation: `${prefix}/content.html`, evaluationLocation: `${prefix}/evaluation.html` };
}
