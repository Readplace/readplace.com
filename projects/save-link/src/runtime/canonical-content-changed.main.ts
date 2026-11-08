import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { readEnv } from "@packages/require-env";
import { CANONICAL_CONTENT_CHANGED_ENV } from "./canonical-content-changed.env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";
import { initCanonicalContentChangedHandler } from "./domain/save-link/canonical-content-changed-handler";
import { initGenerateSummaryDispatch } from "./dep-bundles/generate-summary-dispatch";

const env = readEnv(CANONICAL_CONTENT_CHANGED_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const { findArticleContent } = initFindArticleContent({
	dynamoClient,
	s3Client,
	tableName: articlesTable,
});

const { store } = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
});

const dispatchGenerateSummary = initGenerateSummaryDispatch({ sqsClient, generateSummaryQueueUrl });

export const handler = initCanonicalContentChangedHandler({
	loadArticle: store.load,
	findArticleContent,
	dispatchGenerateSummary,
	logger: consoleLogger,
});
