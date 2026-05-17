import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import OpenAI from "openai";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/hutch-infra-components/runtime";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { requireEnv } from "../require-env";
import { initReadTierSource } from "./providers/article-store/read-tier-source";
import { initListAvailableTierSources } from "./domain/select-content/list-available-tier-sources";
import { initSelectMostCompleteContent } from "./domain/select-content/select-content";
import { SELECT_CONTENT_TIMEOUTS } from "./domain/select-content/timeouts";
import { initWriteCanonicalContent } from "./providers/article-store/promote-tier-to-canonical";
import { initFindContentSourceTier } from "./providers/article-store/find-content-source-tier";
import { initSelectMostCompleteContentHandler } from "./domain/select-content/select-most-complete-content-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

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

export const handler = initSelectMostCompleteContentHandler({
	listAvailableTierSources,
	selectMostCompleteContent,
	writeCanonicalContent,
	findContentSourceTier,
	loadArticle: store.load,
	transitionAndPersist,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});
