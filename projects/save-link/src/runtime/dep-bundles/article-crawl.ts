import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	initDynamoDbMarkCrawlStage,
	type MarkCrawlStage,
} from "../providers/article-crawl/mark-crawl-stage";
import {
	initDynamoDbMarkCrawlProgress,
	type MarkCrawlProgress,
} from "../providers/article-crawl/mark-crawl-progress";
import {
	initDynamoDbMarkCrawlPartial,
	type MarkCrawlPartial,
} from "../providers/article-crawl/mark-crawl-partial";
import { initUpdateFetchTimestamp } from "../providers/article-crawl/update-fetch-timestamp";
import type { UpdateFetchTimestamp } from "../domain/save-link/update-fetch-timestamp-handler";

export type ArticleCrawlDepBundle = {
	markCrawlStage: MarkCrawlStage;
	markCrawlProgress: MarkCrawlProgress;
	markCrawlPartial: MarkCrawlPartial;
	updateFetchTimestamp: UpdateFetchTimestamp;
};

export function initArticleCrawlDepBundle(deps: {
	dynamoClient: DynamoDBDocumentClient;
	articlesTable: string;
	logger: HutchLogger;
}): ArticleCrawlDepBundle {
	const { markCrawlStage } = initDynamoDbMarkCrawlStage({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { markCrawlProgress } = initDynamoDbMarkCrawlProgress({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { markCrawlPartial } = initDynamoDbMarkCrawlPartial({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
		logger: deps.logger,
	});
	const { updateFetchTimestamp } = initUpdateFetchTimestamp({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	return { markCrawlStage, markCrawlProgress, markCrawlPartial, updateFetchTimestamp };
}
