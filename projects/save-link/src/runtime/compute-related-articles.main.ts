import { initCreateDeepseekMessage } from "@packages/ai-message";
import { initDynamoDbRelatedArticles } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { initComputeRelatedArticlesHandler } from "./domain/related-articles/compute-related-articles-handler";
import { initSelectRelatedArticles } from "./domain/related-articles/related-articles-selector";
import { RELATED_ARTICLES_TIMEOUTS } from "./domain/related-articles/timeouts";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
});

const createMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

const { selectRelatedArticles } = initSelectRelatedArticles({
	createMessage,
	logger: consoleLogger,
});

const {
	findRelatedArticles,
	findRelatedCandidateArticles,
	findRelatedTargetArticle,
	markRelatedArticlesReady,
	markRelatedArticlesSkipped,
} = initDynamoDbRelatedArticles({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initComputeRelatedArticlesHandler({
	findRelatedArticles,
	findRelatedTargetArticle,
	findRelatedCandidateArticles,
	selectRelatedArticles,
	markRelatedArticlesReady,
	markRelatedArticlesSkipped,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});
