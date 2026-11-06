import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { MarkCrawlStage } from "../../domain/crawl-article-state/crawl-stage.types";

export type { CrawlStage, MarkCrawlStage } from "../../domain/crawl-article-state/crawl-stage.types";

const CrawlStageRow = z.object({ url: z.string() });

/* Stage writes are transient progress markers that get superseded once the
 * row's status flips terminal. The aggregate's own writers REMOVE the stage
 * attribute on transitions to terminal states, so we don't route stage writes
 * through the aggregate — every status writer would otherwise have to know
 * about stage. Keeps the aggregate-as-sole-status-writer rule intact while
 * giving the worker a cheap "where am I" beacon. */
export function initDynamoDbMarkCrawlStage(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { markCrawlStage: MarkCrawlStage } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CrawlStageRow,
	});

	const markCrawlStage: MarkCrawlStage = async ({ url, stage }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Unconditional: stages are monotonic by code order in the save-link
		// worker, the worker is the only writer, and SQS redelivery just repeats
		// the same sequence.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression: "SET crawlStage = :stage",
			ExpressionAttributeValues: { ":stage": stage },
		});
	};

	return { markCrawlStage };
}
