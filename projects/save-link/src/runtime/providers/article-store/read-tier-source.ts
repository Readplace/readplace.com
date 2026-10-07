import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { CandidateId } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";
import { type TierSource, TierSourceMetadataSchema } from "../../domain/select-content/tier-source.types";
import { candidateManifestKey } from "./candidate-object-keys";

export type ReadTierSource = (params: { url: string; tier: Tier; candidateId?: CandidateId }) => Promise<TierSource | undefined>;

export function initReadTierSource(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
	logger: HutchLogger;
}): { readTierSource: ReadTierSource } {
	const { client, bucketName, logger } = deps;
	async function tryGetObject(key: string): Promise<string | undefined> {
		try {
			const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
			if (!response.Body) return undefined;
			return await response.Body.transformToString("utf-8");
		} catch (error) {
			if (error instanceof S3ServiceException && error.name === "NoSuchKey") return undefined;
			throw error;
		}
	}
	const readTierSource: ReadTierSource = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const metadataKey = params.candidateId === undefined
			? id.toS3SourceMetadataKey({ tier: params.tier })
			: candidateManifestKey({ ...params, candidateId: params.candidateId });
		const metadataRaw = await tryGetObject(metadataKey);
		if (metadataRaw === undefined) return undefined;
		const parsed = TierSourceMetadataSchema.safeParse(JSON.parse(metadataRaw));
		if (!parsed.success) {
			logger.info("[ReadTierSource] malformed metadata sidecar", { url: params.url, tier: params.tier });
			return undefined;
		}
		const htmlKey = parsed.data.htmlLocation ?? id.toS3SourceKey({ tier: params.tier });
		const html = await tryGetObject(htmlKey);
		if (html === undefined) return undefined;
		if (parsed.data.evaluationLocation === undefined) return { tier: params.tier, html, metadata: parsed.data };
		const evaluationHtml = await tryGetObject(parsed.data.evaluationLocation);
		if (evaluationHtml === undefined) return undefined;
		return { tier: params.tier, html, evaluationHtml, metadata: parsed.data };
	};
	return { readTierSource };
}
