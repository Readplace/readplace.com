import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initDynamoDbMarkCrawlStage,
	type MarkCrawlStage,
} from "../providers/article-crawl/mark-crawl-stage";
import {
	initDynamoDbMarkCrawlProgress,
	type MarkCrawlProgress,
} from "../providers/article-crawl/mark-crawl-progress";
import { initUpdateFetchTimestamp } from "../providers/article-crawl/update-fetch-timestamp";
import type { UpdateFetchTimestamp } from "../domain/save-link/update-fetch-timestamp-handler";

export type ArticleCrawlDepBundle = {
	markCrawlStage: MarkCrawlStage;
	markCrawlProgress: MarkCrawlProgress;
	updateFetchTimestamp: UpdateFetchTimestamp;
};

export function initArticleCrawlDepBundle(deps: {
	dynamoClient: DynamoDBDocumentClient;
	articlesTable: string;
}): ArticleCrawlDepBundle {
	const { markCrawlStage } = initDynamoDbMarkCrawlStage({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { markCrawlProgress } = initDynamoDbMarkCrawlProgress({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { updateFetchTimestamp } = initUpdateFetchTimestamp({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	return { markCrawlStage, markCrawlProgress, updateFetchTimestamp };
}
