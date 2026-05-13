/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "./tier.types";

const CanonicalContentRow = z.object({
	contentLocation: dynamoField(z.string()),
	contentSourceTier: dynamoField(z.string()),
});

/**
 * Copies the winning per-tier source to the canonical S3 key and writes the
 * three columns the Article aggregate does not own: contentLocation,
 * contentSourceTier, canonicalSourceTier.
 *
 * Callers MUST invoke this BEFORE the aggregate's `promoteTier` /
 * `recrawlPromoteTier` transition: the aggregate save flips `crawlStatus` to
 * "ready", which is the signal anything observing the row uses to decide that
 * canonical content is readable. If we flipped the status first, a concurrent
 * read could see "ready" before the canonical object exists in S3.
 */
export type WriteCanonicalContent = (params: {
	url: string;
	tier: Tier;
}) => Promise<void>;

export function initWriteCanonicalContent(deps: {
	dynamoClient: DynamoDBDocumentClient;
	s3Client: S3Client;
	tableName: string;
	bucketName: string;
}): { writeCanonicalContent: WriteCanonicalContent } {
	const { dynamoClient, s3Client, tableName, bucketName } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: CanonicalContentRow,
	});

	const writeCanonicalContent: WriteCanonicalContent = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const sourceKey = id.toS3SourceKey({ tier: params.tier });
		const canonicalKey = id.toS3ContentKey();

		await s3Client.send(
			new CopyObjectCommand({
				Bucket: bucketName,
				Key: canonicalKey,
				CopySource: `${bucketName}/${encodeURIComponent(sourceKey)}`,
				ContentType: "text/html; charset=utf-8",
				MetadataDirective: "REPLACE",
			}),
		);

		await articleTable.update({
			Key: { url: id.value },
			UpdateExpression:
				"SET contentLocation = :cl, contentSourceTier = :cst, canonicalSourceTier = :cst",
			ExpressionAttributeValues: {
				":cl": `s3://${bucketName}/${canonicalKey}`,
				":cst": params.tier,
			},
		});
	};

	return { writeCanonicalContent };
}
/* c8 ignore stop */
