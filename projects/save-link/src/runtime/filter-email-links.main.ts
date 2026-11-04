import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initDeepseekClient } from "@packages/ai-message";
import { initDynamoDbReadlistDefinitions, initDynamoDbReadlistFitOverrides } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	createAiMessageForEngine,
	initDecideReadlistFitWithDeepseek,
	ReadlistFitEngineSchema,
} from "@packages/readlist-fit";
import { readEnv } from "@packages/require-env";
import { FILTER_EMAIL_LINKS_ENV } from "./filter-email-links.env";
import { initFilterEmailLinksHandler } from "./domain/filter-email-links/filter-email-links-handler";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./domain/filter-email-links/readlist-fit-log-lines.types";
import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./domain/filter-email-links/timeouts";

const env = readEnv(FILTER_EMAIL_LINKS_ENV);

const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const eventBusName = env.EVENT_BUS_NAME;
const readlistFitEngine = ReadlistFitEngineSchema.parse(env.READLIST_FIT_ENGINE);

const logger = Logger.from(consoleLogger);

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
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

const { listReadlistFitOverrides } = initDynamoDbReadlistFitOverrides({
	client: createDynamoDocumentClient(),
	userArticlesTableName: userArticlesTable,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initFilterEmailLinksHandler({
	listReadlistDefinitions,
	listReadlistFitOverrides,
	decideReadlistFit,
	publishEvent,
	logger,
	fitDecidedLog: Logger.fromJSON<ReadlistFitDecidedLine>(),
	fitUnsureLog: Logger.fromJSON<ReadlistFitUnsureLine>(),
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
	now: () => new Date(),
});
