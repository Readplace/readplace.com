import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { consoleLogger } from "@packages/hutch-logger";
import { initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import { requireEnv } from "../require-env";
import { initRefreshArticleContent } from "../save-link/refresh-article-content";
import { initRefreshArticleContentHandler } from "../save-link/refresh-article-content-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

const client = createDynamoDocumentClient();
const sqsClient = new SQSClient({});

const { refreshArticleContent } = initRefreshArticleContent({
	client,
	tableName: articlesTable,
});

const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: generateSummaryQueueUrl,
	command: GenerateSummaryCommand,
});

export const handler = initRefreshArticleContentHandler({
	refreshArticleContent,
	dispatchGenerateSummary,
	logger: consoleLogger,
});
