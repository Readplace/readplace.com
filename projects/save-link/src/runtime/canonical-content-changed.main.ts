import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { type CrawlSettledEvent, GenerateSummaryCommand, initLogCrawlSettled } from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/infra-components/runtime";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { readEnv } from "@packages/require-env";
import { CANONICAL_CONTENT_CHANGED_ENV } from "./canonical-content-changed.env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";
import { initCanonicalContentChangedHandler } from "./domain/save-link/canonical-content-changed-handler";

const env = readEnv(CANONICAL_CONTENT_CHANGED_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const eventBusName = env.EVENT_BUS_NAME;
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

const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: generateSummaryQueueUrl,
	command: GenerateSummaryCommand,
});

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

export const handler = initCanonicalContentChangedHandler({
	findArticleContent,
	transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
});
