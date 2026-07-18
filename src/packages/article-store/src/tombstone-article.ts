import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";

/** Every derived-from-content column the tombstone strips. The row itself
 * survives (url, routeId, originalUrl, savedAt) so in-flight aggregate
 * transitions still load it and reader-permalink ids still resolve to
 * "removed", never "never existed". */
const CONTENT_BEARING_COLUMNS = [
	"content",
	"contentLocation",
	"contentSourceTier",
	"canonicalSourceTier",
	"crawlVersions",
	"summary",
	"summaryExcerpt",
	"summaryInputTokens",
	"summaryOutputTokens",
	"summarySourceContentHash",
	"summaryFailureReason",
	"summaryPendingSince",
	"summaryStage",
	"summaryAutoHealAttempts",
	"summaryAutoHealLastAttemptAt",
	"crawlFailureReason",
	"crawlUnsupportedReason",
	"crawlPendingSince",
	"crawlFailedAt",
	"crawlStage",
	"crawlPartCurrent",
	"crawlPartTotal",
	"canonicalContentHash",
	"bodyHash",
	"etag",
	"lastModified",
	"contentFetchedAt",
	"imageUrl",
] as const;

/** 1. Both axes land on terminal, non-error states so pollers stop, the
 *     failed-articles canary never surfaces the row, and a redriven aggregate
 *     load still parses. Metadata is re-stubbed to the hostname — already
 *     derivable from the URL itself — so nothing content-derived survives.
 *  2. Set-once so a redelivered purge keeps the original purge instant.
 */
export type TombstoneArticle = (params: { url: string; at: Date }) => Promise<void>;

export function initTombstoneArticle(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { tombstoneArticle: TombstoneArticle } {
	const articleTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: z.object({}),
	});

	const tombstoneArticle: TombstoneArticle = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const hostname = new URL(params.url).hostname;
		try {
			await articleTable.update({
				Key: { url: id.value },
				UpdateExpression:
					"SET purgedAt = if_not_exists(purgedAt, :now), " /* 2 */ +
					"crawlStatus = :ready, summaryStatus = :skipped, summarySkippedReason = :skippedReason, " /* 1 */ +
					"title = :hostname, siteName = :hostname, excerpt = :empty, wordCount = :zero, estimatedReadTime = :zero" +
					` REMOVE ${CONTENT_BEARING_COLUMNS.join(", ")}`,
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":now": params.at.toISOString(),
					":ready": "ready",
					":skipped": "skipped",
					":skippedReason": "content-purged",
					":hostname": hostname,
					":empty": "",
					":zero": 0,
				},
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	return { tombstoneArticle };
}
