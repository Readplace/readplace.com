import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/hutch-logger";
import {
	GenerateSummaryCommand,
} from "@packages/hutch-infra-components";
import { initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { requireEnv } from "../require-env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";
import { initAnonymousLinkSavedHandler } from "./domain/save-link/anonymous-link-saved-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const { findArticleContent } = initFindArticleContent({
	dynamoClient,
	s3Client,
	tableName: articlesTable,
});

const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: generateSummaryQueueUrl,
	command: GenerateSummaryCommand,
});

export const handler = initAnonymousLinkSavedHandler({
	dispatchGenerateSummary,
	findArticleContent,
	logger: consoleLogger,
});
