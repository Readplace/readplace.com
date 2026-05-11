import assert from "node:assert";
import { CrawlStatusSchema } from "@packages/article-state-types";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";

const ArticleCrawlRow = z.object({
	url: z.string(),
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	crawlStage: dynamoField(
		z.enum([
			"crawl-fetching",
			"crawl-fetched",
			"crawl-parsed",
			"crawl-metadata-written",
			"crawl-content-uploaded",
		]),
	),
});

type ArticleCrawlRowShape = z.infer<typeof ArticleCrawlRow>;

function rowToArticleCrawl(
	row: ArticleCrawlRowShape | undefined,
): ArticleCrawl | undefined {
	if (!row) return undefined;
	if (row.crawlStatus === "failed") {
		assert(
			row.crawlFailureReason,
			"crawlStatus=failed row must carry a crawlFailureReason",
		);
		return { status: "failed", reason: row.crawlFailureReason };
	}
	if (row.crawlStatus === "unsupported") {
		assert(
			row.crawlUnsupportedReason,
			"crawlStatus=unsupported row must carry a crawlUnsupportedReason",
		);
		return { status: "unsupported", reason: row.crawlUnsupportedReason };
	}
	if (row.crawlStatus === "pending") {
		return row.crawlStage
			? { status: "pending", stage: row.crawlStage }
			: { status: "pending" };
	}
	if (row.crawlStatus === "ready") return { status: "ready" };
	// Legacy row (status attribute missing). Return undefined so the caller
	// defers to whether S3 content exists — pre-S3-migration content lived in
	// the row, but post-migration rows have empty `content` while S3 holds the
	// body. Either way, the reader-slot dispatcher's content check resolves to
	// ready (content present) or unavailable (no content anywhere).
	return undefined;
}

export function initDynamoDbArticleCrawl(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleCrawlRow,
	});

	const findArticleCrawlStatus: FindArticleCrawlStatus = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get({ url: articleResourceUniqueId.value });
		return rowToArticleCrawl(row);
	};

	const markCrawlPending: MarkCrawlPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET crawlStatus = :pending",
				ConditionExpression:
					"attribute_not_exists(crawlStatus) OR crawlStatus <> :ready",
				ExpressionAttributeValues: {
					":pending": "pending",
					":ready": "ready",
				},
			});
		} catch (err) {
			if (!(err instanceof ConditionalCheckFailedException)) throw err;
		}
	};

	const forceMarkCrawlPending: ForceMarkCrawlPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET crawlStatus = :pending REMOVE crawlFailureReason, crawlUnsupportedReason",
			ExpressionAttributeValues: {
				":pending": "pending",
			},
		});
	};

	return {
		findArticleCrawlStatus,
		markCrawlPending,
		forceMarkCrawlPending,
	};
}
