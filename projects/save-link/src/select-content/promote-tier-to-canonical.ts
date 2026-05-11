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
import type { TierSourceMetadata } from "./tier-source.types";

const ArticleRow = z.object({
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	wordCount: dynamoField(z.number()),
	estimatedReadTime: dynamoField(z.number()),
	imageUrl: dynamoField(z.string()),
	contentLocation: dynamoField(z.string()),
	contentSourceTier: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
});

export type PromoteTierToCanonical = (params: {
	url: string;
	tier: Tier;
	metadata: TierSourceMetadata;
}) => Promise<void>;

export function initPromoteTierToCanonical(deps: {
	dynamoClient: DynamoDBDocumentClient;
	s3Client: S3Client;
	tableName: string;
	bucketName: string;
	now: () => Date;
}): { promoteTierToCanonical: PromoteTierToCanonical } {
	const { dynamoClient, s3Client, tableName, bucketName, now } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: ArticleRow,
	});

	const promoteTierToCanonical: PromoteTierToCanonical = async (params) => {
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

		const setClauses = [
			"title = :t",
			"siteName = :s",
			"excerpt = :e",
			"wordCount = :w",
			"estimatedReadTime = :r",
			"contentLocation = :cl",
			"contentSourceTier = :cst",
			"contentFetchedAt = :cfa",
			"canonicalSourceTier = :cst",
			// crawlStatus flips to "ready" atomically with the canonical write so
			// "ready" exclusively means "canonical content is available to read".
			// Per-tier workers no longer pre-mark ready; that previously left rows
			// reading ready while title/excerpt/wordCount were still hostname stubs
			// when the selector returned a tie and never promoted a canonical.
			"crawlStatus = :ready",
		];
		const values: Record<string, unknown> = {
			":t": params.metadata.title,
			":s": params.metadata.siteName,
			":e": params.metadata.excerpt,
			":w": params.metadata.wordCount,
			":r": params.metadata.estimatedReadTime,
			":cl": `s3://${bucketName}/${canonicalKey}`,
			":cst": params.tier,
			":cfa": now().toISOString(),
			":ready": "ready",
		};
		if (params.metadata.imageUrl) {
			setClauses.push("imageUrl = :img");
			values[":img"] = params.metadata.imageUrl;
		}

		await articleTable.update({
			Key: { url: id.value },
			UpdateExpression: `SET ${setClauses.join(", ")} REMOVE crawlFailureReason, crawlFailedAt, crawlUnsupportedReason`,
			ExpressionAttributeValues: values,
		});
	};

	return { promoteTierToCanonical };
}
/* c8 ignore stop */
