import { createDynamoDocumentClient } from "@packages/storage-client";
import { consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { UPDATE_FETCH_TIMESTAMP_ENV } from "./update-fetch-timestamp.env";
import { initUpdateFetchTimestamp } from "./providers/article-crawl/update-fetch-timestamp";
import { initUpdateFetchTimestampHandler } from "./domain/save-link/update-fetch-timestamp-handler";

const env = readEnv(UPDATE_FETCH_TIMESTAMP_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;

const client = createDynamoDocumentClient();

const { updateFetchTimestamp } = initUpdateFetchTimestamp({
	client,
	tableName: articlesTable,
});

export const handler = initUpdateFetchTimestampHandler({
	updateFetchTimestamp,
	logger: consoleLogger,
});
