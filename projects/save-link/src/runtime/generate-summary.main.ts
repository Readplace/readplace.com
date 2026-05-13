import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import OpenAI from "openai";
import { initCreateDeepseekMessage } from "../generate-summary/create-deepseek-message";
import { initGenerateSummaryHandler } from "../generate-summary/generate-summary-handler";
import { initLinkSummariser } from "../generate-summary/link-summariser";
import { MAX_SUMMARY_LENGTH } from "../generate-summary/max-summary-length";
import { initDynamoDbMarkSummaryStage } from "../generate-summary/mark-summary-stage";
import { stripHtml } from "../generate-summary/strip-html";
import { GENERATE_SUMMARY_TIMEOUTS } from "../generate-summary/timeouts";
import { requireEnv } from "../require-env";
import { initFindArticleContent } from "../save-link/find-article-content";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEventsDepBundle } from "./dep-bundles/events";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const submitLinkQueueUrl = requireEnv("SUBMIT_LINK_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
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

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl, submitLinkQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });

export const handler = initGenerateSummaryHandler({
	summarizeArticle,
	findArticleContent,
	loadArticle: articleAggregate.store.load,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	logger: consoleLogger,
});
