import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";

export type MarkCrawlPartial = (params: {
	url: string;
	content: string;
}) => Promise<void>;

const CrawlPartialRow = z.object({ url: z.string() });

/* Partial-content writes are transient progress markers superseded once the
 * row's status flips terminal. The aggregate's terminal-transition writers
 * REMOVE `partialContent` and `partialContentVersion` alongside the other
 * transient attributes, so we don't route partial writes through the
 * aggregate — same shape as mark-crawl-stage / mark-crawl-progress.
 *
 * The condition expression guards the race where the aggregate has flipped
 * the row terminal between our last read and this write — without it we'd
 * resurrect partial bytes the REMOVE just cleared, leaving stale content on
 * a terminal row. Catching ConditionalCheckFailedException quietly mirrors
 * how markCrawlPending handles the same race in dynamodb-article-crawl.ts. */
export function initDynamoDbMarkCrawlPartial(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	logger: HutchLogger;
}): { markCrawlPartial: MarkCrawlPartial } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CrawlPartialRow,
	});

	const markCrawlPartial: MarkCrawlPartial = async ({ url, content }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET partialContent = :content, partialContentVersion = if_not_exists(partialContentVersion, :zero) + :one",
				ConditionExpression:
					"attribute_not_exists(crawlStatus) OR crawlStatus = :pending",
				ExpressionAttributeValues: {
					":content": content,
					":zero": 0,
					":one": 1,
					":pending": "pending",
				},
			});
		} catch (err) {
			if (!(err instanceof ConditionalCheckFailedException)) throw err;
			deps.logger.debug("[mark-crawl-partial] skipped — row no longer pending", {
				url,
			});
		}
	};

	return { markCrawlPartial };
}
