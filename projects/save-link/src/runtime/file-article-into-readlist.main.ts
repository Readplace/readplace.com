import {
	initCanonicalAliasStore,
	initDynamoDbSavedArticleStore,
	initFindSavedArticleForLink,
} from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initFileArticleIntoReadlist, initResolveCanonicalIdentity } from "@packages/save-article";
import { initFileArticleIntoReadlistCommandHandler } from "./domain/file-article-into-readlist/file-article-into-readlist-command-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const logger = HutchLogger.from(consoleLogger);
const now = () => new Date();
const dynamoClient = createDynamoDocumentClient();

const savedArticleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
	now,
});
const canonicalAlias = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initFileArticleIntoReadlistCommandHandler({
	findSavedArticleForLink: initFindSavedArticleForLink({
		resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: canonicalAlias.findIdentityRow }),
		findArticleById: savedArticleStore.findArticleById,
	}),
	fileArticleIntoReadlist: initFileArticleIntoReadlist({
		allocateSavedAt: savedArticleStore.allocateSavedAt,
		saveReadlistArticle: savedArticleStore.saveReadlistArticle,
		updateArticleStatusAcrossReadlists: savedArticleStore.updateArticleStatusAcrossReadlists,
	}),
	publishEvent,
	logger,
	now,
});
