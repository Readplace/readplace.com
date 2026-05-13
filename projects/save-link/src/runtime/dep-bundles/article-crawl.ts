import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initDynamoDbMarkCrawlStage,
	type MarkCrawlStage,
} from "../../crawl-article-state/mark-crawl-stage";
import { initUpdateFetchTimestamp } from "../../save-link/update-fetch-timestamp";
import type { UpdateFetchTimestamp } from "../../save-link/update-fetch-timestamp-handler";

export type ArticleCrawlDepBundle = {
	markCrawlStage: MarkCrawlStage;
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
	const { updateFetchTimestamp } = initUpdateFetchTimestamp({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	return { markCrawlStage, updateFetchTimestamp };
}
