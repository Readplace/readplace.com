import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initDeepseekClient } from "@packages/ai-message";
import {
	initDynamoDbArticleCrawl,
	initDynamoDbReadlistDefinitions,
	initDynamoDbReadlistFitOverrides,
	initDynamoDbSavedArticleStore,
} from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import {
	createAiMessageForEngine,
	initDecideReadlistFitWithDeepseek,
	ReadlistFitEngineSchema,
} from "@packages/readlist-fit";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initMatchSmartReadlistsHandler } from "./domain/match-smart-readlists/match-smart-readlists-handler";
import type { SmartReadlistMatchDecidedLine } from "./domain/match-smart-readlists/smart-readlist-match-log-lines.types";
import { MATCH_SMART_READLISTS_TIMEOUTS } from "./domain/match-smart-readlists/timeouts";
import { MATCH_SMART_READLISTS_ENV } from "./match-smart-readlists.env";

const env = readEnv(MATCH_SMART_READLISTS_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const readlistFitEngine = ReadlistFitEngineSchema.parse(env.READLIST_FIT_ENGINE);

const logger = Logger.from(consoleLogger);
const now = () => new Date();
const dynamoClient = createDynamoDocumentClient();

const deepseekClient = initDeepseekClient({
	apiKey: env.DEEPSEEK_API_KEY,
	timeoutMs: MATCH_SMART_READLISTS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: MATCH_SMART_READLISTS_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now,
});

const decideReadlistFit = initDecideReadlistFitWithDeepseek({
	createAiMessage: createAiMessageForEngine({ engine: readlistFitEngine, client: deepseekClient }),
	engine: readlistFitEngine,
});

const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
	client: dynamoClient,
	userArticlesTableName: userArticlesTable,
});

const { listReadlistFitOverrides } = initDynamoDbReadlistFitOverrides({
	client: dynamoClient,
	userArticlesTableName: userArticlesTable,
	now,
});

const savedArticleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
	now,
});

const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
	client: dynamoClient,
	tableName: articlesTable,
	now,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

export const handler = initMatchSmartReadlistsHandler({
	findSubscriptionByUserId: initDynamoDbSubscriptionRead({
		client: dynamoClient,
		tableName: env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE,
	}).findByUserId,
	findSmartMatchRevisions: savedArticleStore.findSmartMatchRevisions,
	recordSmartMatchRevision: savedArticleStore.recordSmartMatchRevision,
	listReadlistDefinitions,
	listReadlistFitOverrides,
	findArticleById: savedArticleStore.findArticleById,
	findArticleCrawlStatus,
	fileIntoLiveReadlist: savedArticleStore.fileIntoLiveReadlist,
	decideReadlistFit,
	publishEvent,
	logger,
	decisionLog: Logger.fromJSON<SmartReadlistMatchDecidedLine>(),
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
	now,
});
