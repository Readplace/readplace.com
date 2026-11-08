import { createDynamoDocumentClient } from "@packages/storage-client";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { ANONYMOUS_LINK_SAVED_ENV } from "./anonymous-link-saved.env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";
import { initAnonymousLinkSavedHandler } from "./domain/save-link/anonymous-link-saved-handler";
import { initGenerateSummaryDispatch } from "./dep-bundles/generate-summary-dispatch";

const env = readEnv(ANONYMOUS_LINK_SAVED_ENV);

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

const dispatchGenerateSummary = initGenerateSummaryDispatch({ sqsClient, generateSummaryQueueUrl });

export const handler = initAnonymousLinkSavedHandler({
	dispatchGenerateSummary,
	findArticleContent,
	logger: consoleLogger,
});
