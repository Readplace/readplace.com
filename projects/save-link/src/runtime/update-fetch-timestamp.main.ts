import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "../require-env";
import { initUpdateFetchTimestamp } from "./providers/article-crawl/update-fetch-timestamp";
import { initUpdateFetchTimestampHandler } from "./domain/save-link/update-fetch-timestamp-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");

const client = createDynamoDocumentClient();

const { updateFetchTimestamp } = initUpdateFetchTimestamp({
	client,
	tableName: articlesTable,
});

export const handler = initUpdateFetchTimestampHandler({
	updateFetchTimestamp,
	logger: consoleLogger,
});
