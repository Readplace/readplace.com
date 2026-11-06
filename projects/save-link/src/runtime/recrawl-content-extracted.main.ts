import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, Logger } from "@packages/logger";
import { type CrawlSettledEvent, initLogCrawlSettled } from "@packages/infra-components";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { RECRAWL_CONTENT_EXTRACTED_ENV } from "./recrawl-content-extracted.env";
import { initRecrawlContentExtractedHandler } from "./domain/select-content/recrawl-content-extracted-handler";
import { SELECT_CONTENT_TIMEOUTS } from "./domain/select-content/timeouts";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initSelectContentDepBundle } from "./dep-bundles/select-content";

const env = readEnv(RECRAWL_CONTENT_EXTRACTED_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: SELECT_CONTENT_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "info",
	callTimeoutMs: SELECT_CONTENT_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const { logCrawlSettled } = initLogCrawlSettled({ logger: Logger.fromJSON<CrawlSettledEvent>(), now: () => new Date() });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events, logCrawlSettled });
const selectContent = initSelectContentDepBundle({
	s3Client,
	dynamoClient,
	contentBucketName,
	articlesTable,
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
	now: () => new Date(),
});

export const handler = initRecrawlContentExtractedHandler({
	...selectContent,
	...articleAggregate,
	loadArticle: articleAggregate.store.load,
	now: () => new Date(),
	logger: consoleLogger,
});
