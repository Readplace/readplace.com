import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";
import type { CandidateProvenance } from "../../domain/select-content/tier-source.types";
import { initPersistCandidateArtifact } from "./persist-candidate-artifact";

export type PutTierSource = (params: { url: string; tier: Tier; html: string; evaluationHtml?: string; metadata: CandidateProvenance }) => Promise<void>;

export function initPutTierSource(deps: { client: Pick<S3Client, "send">; bucketName: string }): { putTierSource: PutTierSource } {
	const persistCandidateArtifact = initPersistCandidateArtifact(deps);
	const putTierSource: PutTierSource = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const persisted = await persistCandidateArtifact(params);
		await deps.client.send(new PutObjectCommand({ Bucket: deps.bucketName, Key: id.toS3SourceMetadataKey({ tier: params.tier }), Body: JSON.stringify(persisted), ContentType: "application/json; charset=utf-8" }));
		await deps.client.send(new PutObjectCommand({ Bucket: deps.bucketName, Key: id.toS3SourceKey({ tier: params.tier }), Body: "", ContentType: "text/html; charset=utf-8" }));
	};
	return { putTierSource };
}
