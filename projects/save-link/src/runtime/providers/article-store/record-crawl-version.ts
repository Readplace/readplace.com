import { CopyObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	ArticleResourceUniqueId,
	toCrawlVersionMinuteId,
} from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";
import { appendCrawlVersion } from "../../domain/select-content/crawl-versions";

const CrawlVersionsRow = z.object({
	crawlVersions: dynamoField(z.array(z.string())),
});

/**
 * Snapshots the winning tier source into a per-minute S3 folder and appends the
 * minute id to the row's append-only `crawlVersions` log (unbounded — every
 * version is kept forever, matching the never-pruned snapshots). Callers gate this on
 * "canonical content actually changed", so the copy always writes fresh bytes;
 * a second content-changing crawl in the same minute re-copies to the same key
 * (idempotent overwrite) and the log append dedupes to a no-op. The CAS on the
 * log makes a concurrent racing recorder redeliver via SQS rather than clobber.
 */
export type RecordCrawlVersion = (params: {
	url: string;
	tier: Tier;
	crawledAt: string;
}) => Promise<void>;

export function initRecordCrawlVersion(deps: {
	dynamoClient: DynamoDBDocumentClient;
	s3Client: S3Client;
	tableName: string;
	bucketName: string;
}): { recordCrawlVersion: RecordCrawlVersion } {
	const { dynamoClient, s3Client, tableName, bucketName } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: CrawlVersionsRow,
	});

	const recordCrawlVersion: RecordCrawlVersion = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const minuteId = toCrawlVersionMinuteId(params.crawledAt);
		const sourceKey = id.toS3SourceKey({ tier: params.tier });
		const versionKey = id.toS3ContentVersionKey({ minuteId });

		await s3Client.send(
			new CopyObjectCommand({
				Bucket: bucketName,
				Key: versionKey,
				CopySource: `${bucketName}/${encodeURIComponent(sourceKey)}`,
				ContentType: "text/html; charset=utf-8",
				MetadataDirective: "REPLACE",
			}),
		);

		const row = await articleTable.get(
			{ url: id.value },
			{ projection: ["crawlVersions"] },
		);
		const existing = row?.crawlVersions ?? [];
		const { changed, next } = appendCrawlVersion(existing, minuteId);
		if (!changed) return;

		await articleTable.update({
			Key: { url: id.value },
			UpdateExpression: "SET crawlVersions = :next",
			ConditionExpression: "attribute_not_exists(crawlVersions) OR crawlVersions = :old",
			ExpressionAttributeValues: { ":next": next, ":old": existing },
		});
	};

	return { recordCrawlVersion };
}
