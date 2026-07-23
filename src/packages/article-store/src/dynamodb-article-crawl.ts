import assert from "node:assert";
import { CrawlStatusSchema } from "@packages/article-state-types";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	FindArticleCrawlStatuses,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";

const ArticleCrawlRow = z.object({
	url: z.string(),
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	crawlStage: dynamoField(
		z.enum([
			"crawl-fetching",
			"crawl-fetched",
			"comprehensive-fetching",
			"comprehensive-extracting",
			"comprehensive-cleaning",
			"crawl-parsed",
			"crawl-metadata-written",
			"crawl-content-uploaded",
		]),
	),
	crawlPartCurrent: dynamoField(z.number()),
	crawlPartTotal: dynamoField(z.number()),
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
		const parts =
			row.crawlPartCurrent !== undefined && row.crawlPartTotal !== undefined
				? { current: row.crawlPartCurrent, total: row.crawlPartTotal }
				: undefined;
		const pending: ArticleCrawl = { status: "pending" };
		if (row.crawlStage) pending.stage = row.crawlStage;
		if (parts) pending.parts = parts;
		return pending;
	}
	if (row.crawlStatus === "ready") return { status: "ready" };
	// Legacy row (status attribute missing). Return undefined so the caller
	// defers to whether S3 content exists — pre-S3-migration content lived in
	// the row, but post-migration rows have empty `content` while S3 holds the
	// body. Either way, the reader-slot dispatcher's content check resolves to
	// ready (content present) or unavailable (no content anywhere).
	return undefined;
}

// Loose schema for the batch read: batchGetFromTable runs `schema.parse` on
// every returned item, so a strict schema would discard the whole batch on one
// malformed row. Each row is re-validated strictly below, per row.
const LooseArticleCrawlRow = z.looseObject({ url: z.string() });

export function initDynamoDbArticleCrawl(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findArticleCrawlStatuses: FindArticleCrawlStatuses;
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

	const findArticleCrawlStatuses: FindArticleCrawlStatuses = async (urls) => {
		const result = new Map<string, ArticleCrawl | undefined>();
		const keyToUrls = new Map<string, string[]>();
		for (const url of urls) {
			let normalizedKey: string;
			try {
				normalizedKey = ArticleResourceUniqueId.parse(url).value;
			} catch {
				result.set(url, undefined);
				continue;
			}
			const group = keyToUrls.get(normalizedKey);
			if (group) group.push(url);
			else keyToUrls.set(normalizedKey, [url]);
		}
		if (keyToUrls.size === 0) return result;

		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.tableName,
			schema: LooseArticleCrawlRow,
			keys: [...keyToUrls.keys()].map((url) => ({ url })),
			projection: ArticleCrawlRow.keyof().options,
		});

		const valueByKey = new Map<string, ArticleCrawl | undefined>();
		for (const row of rows) {
			const parsed = ArticleCrawlRow.safeParse(row);
			let value: ArticleCrawl | undefined;
			if (parsed.success) {
				try {
					value = rowToArticleCrawl(parsed.data);
				} catch {
					value = undefined;
				}
			}
			valueByKey.set(row.url, value);
		}
		for (const [key, groupUrls] of keyToUrls) {
			const value = valueByKey.get(key);
			for (const url of groupUrls) result.set(url, value);
		}
		return result;
	};

	const markCrawlPending: MarkCrawlPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET crawlStatus = :pending, crawlPendingSince = :pendingSince",
				ConditionExpression:
					"attribute_not_exists(crawlStatus) OR crawlStatus <> :ready",
				ExpressionAttributeValues: {
					":pending": "pending",
					":pendingSince": deps.now().toISOString(),
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
				"SET crawlStatus = :pending, crawlPendingSince = :pendingSince REMOVE crawlFailureReason, crawlUnsupportedReason",
			ExpressionAttributeValues: {
				":pending": "pending",
				":pendingSince": deps.now().toISOString(),
			},
		});
	};

	return {
		findArticleCrawlStatus,
		findArticleCrawlStatuses,
		markCrawlPending,
		forceMarkCrawlPending,
	};
}
