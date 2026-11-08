import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { type CrawlSettledEvent, initLogCrawlSettled } from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { readEnv } from "@packages/require-env";
import { SELECT_MOST_COMPLETE_CONTENT_ENV } from "./select-most-complete-content.env";
import { initSelectContentDepBundle } from "./dep-bundles/select-content";
import { SELECT_CONTENT_TIMEOUTS } from "./domain/select-content/timeouts";
import { initSelectMostCompleteContentHandler } from "./domain/select-content/select-most-complete-content-handler";
import { initGenerateSummaryDispatch } from "./dep-bundles/generate-summary-dispatch";

const env = readEnv(SELECT_MOST_COMPLETE_CONTENT_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
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

const { store } = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
});

const dispatchGenerateSummary = initGenerateSummaryDispatch({ sqsClient, generateSummaryQueueUrl });

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { dispatchEffect } = initLambdaEffectDispatcher({
	dispatchGenerateSummary,
	publishEvent,
});

const { logCrawlSettled } = initLogCrawlSettled({ logger: Logger.fromJSON<CrawlSettledEvent>(), now: () => new Date() });
const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
	logCrawlSettled,
});

export const handler = initSelectMostCompleteContentHandler({
	...selectContent,
	loadArticle: store.load,
	transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
});
