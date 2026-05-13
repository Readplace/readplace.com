/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";
import type { TierSourceMetadata } from "../../domain/select-content/tier-source.types";

export type PutTierSource = (params: {
	url: string;
	tier: Tier;
	html: string;
	metadata: TierSourceMetadata;
}) => Promise<void>;

export function initPutTierSource(deps: {
	client: S3Client;
	bucketName: string;
}): { putTierSource: PutTierSource } {
	const { client, bucketName } = deps;

	const putTierSource: PutTierSource = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const htmlKey = id.toS3SourceKey({ tier: params.tier });
		const metadataKey = id.toS3SourceMetadataKey({ tier: params.tier });

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: htmlKey,
				Body: params.html,
				ContentType: "text/html; charset=utf-8",
			}),
		);

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: metadataKey,
				Body: JSON.stringify(params.metadata),
				ContentType: "application/json; charset=utf-8",
			}),
		);
	};

	return { putTierSource };
}
/* c8 ignore stop */
