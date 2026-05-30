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
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { initCreateDeepseekMessage } from "./domain/generate-summary/create-deepseek-message";
import { initDynamoDbMarkSummaryStage } from "./providers/article-crawl/mark-summary-stage";
import { initGenerateSummaryHandler } from "./domain/generate-summary/generate-summary-handler";
import { initLinkSummariser } from "./domain/generate-summary/link-summariser";
import { MAX_SUMMARY_LENGTH } from "./domain/generate-summary/max-summary-length";
import { stripHtml } from "./domain/generate-summary/strip-html";
import { GENERATE_SUMMARY_TIMEOUTS } from "./domain/generate-summary/timeouts";
import { requireEnv } from "../require-env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: GENERATE_SUMMARY_TIMEOUTS.deepseekMs,
});

const createMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

const { findArticleContent } = initFindArticleContent({
	dynamoClient,
	s3Client,
	tableName: articlesTable,
});

const { markSummaryStage } = initDynamoDbMarkSummaryStage({
	client: dynamoClient,
	tableName: articlesTable,
});

const { summarizeArticle } = initLinkSummariser({
	createMessage,
	logger: consoleLogger,
	cleanContent: stripHtml,
	isTooShortToSummarize: (cleanedText) => {
		const visibleLength = cleanedText.replace(/\s/g, "").length;
		return visibleLength <= MAX_SUMMARY_LENGTH * 3;
	},
	markSummaryStage,
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

export const handler = initGenerateSummaryHandler({
	summarizeArticle,
	findArticleContent,
	loadArticle: store.load,
	transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
});
