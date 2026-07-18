import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "./crawl-version-log";

const CrawlVersionsRow = z.object({
	crawlVersions: dynamoField(z.array(StoredCrawlVersionSchema)),
});

/** Drop the named minute-ids from the row's crawlVersions log. Compare-and-swap
 * on the raw stored value: a concurrent writer makes the condition fail and the
 * SQS redelivery re-reads and retries. Already-absent minute-ids are a no-op,
 * so an at-least-once redelivery converges. */
export type PruneCrawlVersions = (params: {
	url: string;
	minuteIds: string[];
}) => Promise<void>;

export function initPruneCrawlVersions(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { pruneCrawlVersions: PruneCrawlVersions } {
	const articleTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CrawlVersionsRow,
	});

	const pruneCrawlVersions: PruneCrawlVersions = async (params) => {
		if (params.minuteIds.length === 0) return;

		const row = await articleTable.get(
			{ url: ArticleResourceUniqueId.parse(params.url).value },
			{ projection: ["crawlVersions"] },
		);
		const existing = row?.crawlVersions;
		if (existing === undefined) return;

		const next = existing.filter(
			(stored) => !params.minuteIds.includes(normalizeCrawlVersion(stored).minuteId),
		);
		if (next.length === existing.length) return;

		await articleTable.update({
			Key: { url: ArticleResourceUniqueId.parse(params.url).value },
			UpdateExpression: "SET crawlVersions = :next",
			ConditionExpression: "crawlVersions = :old",
			ExpressionAttributeValues: { ":next": next, ":old": existing },
		});
	};

	return { pruneCrawlVersions };
}
