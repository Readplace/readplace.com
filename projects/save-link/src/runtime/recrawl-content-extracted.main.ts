import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initRecrawlContentExtractedHandler } from "./domain/select-content/recrawl-content-extracted-handler";
import { SELECT_CONTENT_TIMEOUTS } from "./domain/select-content/timeouts";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initSelectContentDepBundle } from "./dep-bundles/select-content";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

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
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const selectContent = initSelectContentDepBundle({
	s3Client,
	dynamoClient,
	contentBucketName,
	articlesTable,
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
	logger: consoleLogger,
});

export const handler = initRecrawlContentExtractedHandler({
	...selectContent,
	...articleAggregate,
	loadArticle: articleAggregate.store.load,
	now: () => new Date(),
	logger: consoleLogger,
});
