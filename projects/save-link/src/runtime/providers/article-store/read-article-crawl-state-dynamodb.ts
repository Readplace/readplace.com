/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { ReadArticleCrawlState, CrawlStatus, PickedTier } from "../../domain/crawl-article-state/read-tier-snapshot";

const CrawlStatusSchema = z.enum(["ready", "failed", "pending", "unsupported"]);
const CanonicalSourceTierSchema = z.enum(["tier-0", "tier-1"]);

const ArticleRow = z.object({
	crawlStatus: dynamoField(CrawlStatusSchema),
	canonicalSourceTier: dynamoField(CanonicalSourceTierSchema),
});

export function initReadArticleCrawlStateDynamoDb(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { readArticleCrawlState: ReadArticleCrawlState } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleRow,
	});

	const readArticleCrawlState: ReadArticleCrawlState = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["crawlStatus", "canonicalSourceTier"] },
		);
		const crawlStatus: CrawlStatus = row?.crawlStatus ?? "absent";
		const canonicalSourceTier: PickedTier = row?.canonicalSourceTier ?? "none";
		return { crawlStatus, canonicalSourceTier };
	};

	return { readArticleCrawlState };
}
/* c8 ignore stop */
