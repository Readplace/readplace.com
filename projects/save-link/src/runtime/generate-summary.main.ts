import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { type CrawlSettledEvent, GenerateSummaryCommand, initLogCrawlSettled } from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekMessage, initDeepseekClient } from "@packages/ai-message";
import { initDynamoDbArticleStore, initDynamoDbMeteredLegLedger } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { initDynamoDbMarkSummaryStage } from "./providers/article-crawl/mark-summary-stage";
import { initGenerateSummaryHandler } from "./domain/generate-summary/generate-summary-handler";
import { initLinkSummariser } from "./domain/generate-summary/link-summariser";
import { initRunMeteredLeg } from "./domain/metered-leg/run-metered-leg";
import { MAX_SUMMARY_LENGTH } from "@packages/provider-contracts/article-summary";
import { stripHtml } from "./domain/generate-summary/strip-html";
import { sampleSectionsForSummary } from "./domain/generate-summary/sample-sections";
import { GENERATE_SUMMARY_TIMEOUTS } from "./domain/generate-summary/timeouts";
import { requireEnv } from "@packages/require-env";
import { initFindArticleContent } from "./providers/article-store/find-article-content";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: GENERATE_SUMMARY_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "info",
	callTimeoutMs: GENERATE_SUMMARY_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const createMessage = initCreateDeepseekMessage({ client: deepseekClient });

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
	fitSummaryInput: (input) => sampleSectionsForSummary({ ...input, cleanContent: stripHtml }),
	isTooShortToSummarize: (cleanedText) => {
		const visibleLength = cleanedText.replace(/\s/g, "").length;
		return visibleLength <= MAX_SUMMARY_LENGTH * 3;
	},
	markSummaryStage,
});

const meteredLegLedger = initDynamoDbMeteredLegLedger({
	client: dynamoClient,
	tableName: articlesTable,
	now: () => new Date(),
});

const runMeteredLeg = initRunMeteredLeg({
	...meteredLegLedger,
	logger: consoleLogger,
	now: () => new Date(),
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

export const handler = initGenerateSummaryHandler({
	summarizeArticle,
	runMeteredLeg,
	findArticleContent,
	loadArticle: store.load,
	transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
});
