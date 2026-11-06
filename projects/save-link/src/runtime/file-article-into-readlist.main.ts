import {
	initCanonicalAliasStore,
	initDynamoDbSavedArticleStore,
	initFindSavedArticleForLink,
} from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { FILE_ARTICLE_INTO_READLIST_ENV } from "./file-article-into-readlist.env";
import { initFileArticleIntoReadlist, initResolveCanonicalIdentity } from "@packages/save-article";
import { initFileArticleIntoReadlistCommandHandler } from "./domain/file-article-into-readlist/file-article-into-readlist-command-handler";

const env = readEnv(FILE_ARTICLE_INTO_READLIST_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const eventBusName = env.EVENT_BUS_NAME;

const logger = Logger.from(consoleLogger);
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
});
