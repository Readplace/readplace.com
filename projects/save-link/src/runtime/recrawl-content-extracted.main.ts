import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import OpenAI from "openai";
import { initDynamoDbArticleStore } from "../article-aggregate/dynamodb-article-store";
import { initLambdaEffectDispatcher } from "../article-aggregate/lambda-effect-dispatcher";
import { requireEnv } from "../require-env";
import { initFindContentSourceTier } from "../select-content/find-content-source-tier";
import { initListAvailableTierSources } from "../select-content/list-available-tier-sources";
import { initWriteCanonicalContent } from "../select-content/promote-tier-to-canonical";
import { initReadTierSource } from "../select-content/read-tier-source";
import { initRecrawlContentExtractedHandler } from "../select-content/recrawl-content-extracted-handler";
import { initSelectMostCompleteContent } from "../select-content/select-content";
import { SELECT_CONTENT_TIMEOUTS } from "../select-content/timeouts";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: SELECT_CONTENT_TIMEOUTS.deepseekMs,
});

const { readTierSource } = initReadTierSource({
	client: s3Client,
	bucketName: contentBucketName,
	logger: consoleLogger,
});

const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

const { selectMostCompleteContent } = initSelectMostCompleteContent({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
	logger: consoleLogger,
});

const { writeCanonicalContent } = initWriteCanonicalContent({
	dynamoClient,
	s3Client,
	tableName: articlesTable,
	bucketName: contentBucketName,
});

const { findContentSourceTier } = initFindContentSourceTier({
	dynamoClient,
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

const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
});

export const handler = initRecrawlContentExtractedHandler({
	listAvailableTierSources,
	selectMostCompleteContent,
	writeCanonicalContent,
	findContentSourceTier,
	transitionAndPersist,
	imagesCdnBaseUrl,
	now: () => new Date(),
	logger: consoleLogger,
});
