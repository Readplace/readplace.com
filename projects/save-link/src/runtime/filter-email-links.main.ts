import { initCreateDeepseekThinkingMessage } from "@packages/ai-message";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { initDecideEmailLinks } from "./domain/filter-email-links/decide-email-links";
import { initFilterEmailLinksHandler } from "./domain/filter-email-links/filter-email-links-handler";
import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./domain/filter-email-links/timeouts";

const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const logger = HutchLogger.from(consoleLogger);

const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
});

const { decideEmailLinks } = initDecideEmailLinks({
	createMessage: initCreateDeepseekThinkingMessage({
		createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
	}),
	logger,
});

const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
	client: createDynamoDocumentClient(),
	userArticlesTableName: userArticlesTable,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initFilterEmailLinksHandler({
	listReadlistDefinitions,
	decideEmailLinks,
	publishEvent,
	logger,
});
