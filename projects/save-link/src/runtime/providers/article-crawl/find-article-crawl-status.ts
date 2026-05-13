/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";

const CrawlStatusSchema = z.enum(["ready", "failed", "pending"]);
const CrawlStageSchema = z.enum([
	"crawl-fetching",
	"crawl-fetched",
	"crawl-parsed",
	"crawl-metadata-written",
	"crawl-content-uploaded",
]);

const ArticleCrawlRow = z.object({
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlStage: dynamoField(CrawlStageSchema),
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
	if (row.crawlStatus === "pending") {
		return row.crawlStage
			? { status: "pending", stage: row.crawlStage }
			: { status: "pending" };
	}
	if (row.crawlStatus === "ready") return { status: "ready" };
	return undefined;
}

export function initFindArticleCrawlStatus(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { findArticleCrawlStatus: FindArticleCrawlStatus } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleCrawlRow,
	});

	const findArticleCrawlStatus: FindArticleCrawlStatus = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["crawlStatus", "crawlFailureReason", "crawlStage"] },
		);
		return rowToArticleCrawl(row);
	};

	return { findArticleCrawlStatus };
}
/* c8 ignore stop */
