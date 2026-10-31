import { type DeepseekUsageLine, initCreateDeepseekThinkingMessage, initDeepseekClient } from "@packages/ai-message";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDecideEmailLinks } from "./domain/filter-email-links/decide-email-links";
import { initFilterEmailLinksHandler } from "./domain/filter-email-links/filter-email-links-handler";
import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./domain/filter-email-links/timeouts";

const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const logger = HutchLogger.from(consoleLogger);

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const { decideEmailLinks } = initDecideEmailLinks({
	createMessage: initCreateDeepseekThinkingMessage({ client: deepseekClient }),
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
