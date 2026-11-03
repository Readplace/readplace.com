import assert from "node:assert";
import type { S3Client } from "@aws-sdk/client-s3";
import type { CanonicalCommit } from "@packages/domain/article-aggregate";
import { initPersistCandidateArtifact, type CandidateProvenance, type VerifiedTierSource } from "@packages/tier-source";

export type WriteCanonicalContent = (params: { url: string; source: VerifiedTierSource }) => Promise<Omit<CanonicalCommit, "expected" | "originalUrl">>;

export function initWriteCanonicalContent(deps: { s3Client: Pick<S3Client, "send">; bucketName: string }): { writeCanonicalContent: WriteCanonicalContent } {
	const persistCandidateArtifact = initPersistCandidateArtifact({ client: deps.s3Client, bucketName: deps.bucketName });
	const writeCanonicalContent: WriteCanonicalContent = async (params) => {
		let metadata: CandidateProvenance = params.source.metadata;
		if (metadata.htmlLocation === undefined) {
			assert(metadata.attemptId === "legacy-direct-canonical", "selected candidate must already be persisted");
			metadata = await persistCandidateArtifact({ url: params.url, tier: params.source.tier, html: params.source.html, evaluationHtml: params.source.evaluationHtml, metadata });
		}
		return { contentLocation: `s3://${deps.bucketName}/${metadata.htmlLocation}`, candidateId: metadata.id, tier: params.source.tier };
	};
	return { writeCanonicalContent };
}
