import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initDeepseekClient } from "@packages/ai-message";
import {
	initCanonicalAliasStore,
	initDynamoDbReadlistDefinitions,
	initDynamoDbReadlistFitOverrides,
	initDynamoDbSavedArticleStore,
	initFindSavedArticleForLink,
} from "@packages/article-store";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
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
import { initResolveCanonicalIdentity } from "@packages/save-article";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { FILTER_EMAIL_LINKS_ENV } from "./filter-email-links.env";
import { initFilingsLeftToFile } from "./domain/filter-email-links/filings-left-to-file";
import { initFilterEmailLinksHandler } from "./domain/filter-email-links/filter-email-links-handler";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./domain/filter-email-links/readlist-fit-log-lines.types";
import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./domain/filter-email-links/timeouts";
import { initAdmitTriagedMessage } from "./domain/filter-email-links/triaged-message-admission";

const env = readEnv(FILTER_EMAIL_LINKS_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const inboxEmailLinksTable = env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE;
const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const eventBusName = env.EVENT_BUS_NAME;
const readlistFitEngine = ReadlistFitEngineSchema.parse(env.READLIST_FIT_ENGINE);

const logger = Logger.from(consoleLogger);
const now = () => new Date();
const dynamoClient = createDynamoDocumentClient();

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs,
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
const canonicalAlias = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const findSavedArticleForLink = initFindSavedArticleForLink({
	resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: canonicalAlias.findIdentityRow }),
	findArticleById: savedArticleStore.findArticleById,
});

const admitTriagedMessage = initAdmitTriagedMessage({
	listLinksByEmail: initDynamoDbInboxEmailLink({ client: dynamoClient, tableName: inboxEmailLinksTable }).listLinksByEmail,
	findSubscriptionByUserId: initDynamoDbSubscriptionRead({ client: dynamoClient, tableName: subscriptionProvidersTable })
		.findByUserId,
	now,
});

const filingsLeftToFile = initFilingsLeftToFile({
	listReadlistFitOverrides,
	findSavedArticleForLink,
	findReadlistRemoval: savedArticleStore.findReadlistRemoval,
	logger,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initFilterEmailLinksHandler({
	listReadlistDefinitions,
	listReadlistFitOverrides,
	admitTriagedMessage,
	filingsLeftToFile,
	decideReadlistFit,
	publishEvent,
	logger,
	fitDecidedLog: Logger.fromJSON<ReadlistFitDecidedLine>(),
	fitUnsureLog: Logger.fromJSON<ReadlistFitUnsureLine>(),
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
	now,
});
