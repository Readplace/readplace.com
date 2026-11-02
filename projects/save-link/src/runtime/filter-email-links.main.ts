import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initDeepseekClient } from "@packages/ai-message";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	createAiMessageForEngine,
	initDecideReadlistFitWithDeepseek,
	ReadlistFitEngineSchema,
} from "@packages/readlist-fit";
import { requireEnv } from "@packages/require-env";
import { initFilterEmailLinksHandler } from "./domain/filter-email-links/filter-email-links-handler";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./domain/filter-email-links/readlist-fit-log-lines.types";
import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./domain/filter-email-links/timeouts";

const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const readlistFitEngine = ReadlistFitEngineSchema.parse(requireEnv("READLIST_FIT_ENGINE"));

const logger = HutchLogger.from(consoleLogger);

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const decideReadlistFit = initDecideReadlistFitWithDeepseek({
	createAiMessage: createAiMessageForEngine({ engine: readlistFitEngine, client: deepseekClient }),
	engine: readlistFitEngine,
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
	decideReadlistFit,
	publishEvent,
	logger,
	fitDecidedLog: HutchLogger.fromJSON<ReadlistFitDecidedLine>(),
	fitUnsureLog: HutchLogger.fromJSON<ReadlistFitUnsureLine>(),
	deepseekCallFailedLog: HutchLogger.fromJSON<DeepseekCallFailedLogLine>(),
	now: () => new Date(),
});
