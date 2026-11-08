import { createDynamoDocumentClient } from "@packages/storage-client";
import { consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { UPDATE_FETCH_TIMESTAMP_ENV } from "./update-fetch-timestamp.env";
import { initAdvanceContentFetchedAt } from "./providers/article-crawl/advance-content-fetched-at";
import { initUpdateFetchTimestampHandler } from "./domain/save-link/update-fetch-timestamp-handler";

const env = readEnv(UPDATE_FETCH_TIMESTAMP_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;

const client = createDynamoDocumentClient();

const { advanceContentFetchedAt } = initAdvanceContentFetchedAt({
	client,
	tableName: articlesTable,
});

export const handler = initUpdateFetchTimestampHandler({
	advanceContentFetchedAt,
	logger: consoleLogger,
});
