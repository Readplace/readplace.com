import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";

export type MarkCrawlProgress = (params: {
	url: string;
	partCurrent: number;
	partTotal: number;
}) => Promise<void>;

const CrawlProgressRow = z.object({ url: z.string() });

/* Progress writes are transient markers superseded once the row's status flips
 * terminal. The aggregate's terminal-transition writers REMOVE the part
 * attributes alongside crawlStage, so we don't route progress writes through
 * the aggregate — same shape as mark-crawl-stage. */
export function initDynamoDbMarkCrawlProgress(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { markCrawlProgress: MarkCrawlProgress } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CrawlProgressRow,
	});

	const markCrawlProgress: MarkCrawlProgress = async ({
		url,
		partCurrent,
		partTotal,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET crawlPartCurrent = :current, crawlPartTotal = :total",
			ExpressionAttributeValues: {
				":current": partCurrent,
				":total": partTotal,
			},
		});
	};

	return { markCrawlProgress };
}
