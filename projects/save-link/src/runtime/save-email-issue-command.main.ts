import { S3Client } from "@aws-sdk/client-s3";
import {
	initCanonicalAliasStore,
	initDynamoDbArticleCrawl,
	initDynamoDbGeneratedSummary,
	initDynamoDbSavedArticleStore,
	initS3ReadContent,
} from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initOnboardingSignals } from "@packages/onboarding-signals";
import { readEnv } from "@packages/require-env";
import { SAVE_EMAIL_ISSUE_COMMAND_ENV } from "./save-email-issue-command.env";
import { initFileArticleIntoReadlist } from "@packages/save-article";
import { initSaveEmailIssue } from "./domain/save-email-issue/save-email-issue";
import { initSaveEmailIssueCommandHandler } from "./domain/save-email-issue/save-email-issue-command-handler";
import { initPutTierSource } from "@packages/tier-source";

const env = readEnv(SAVE_EMAIL_ISSUE_COMMAND_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const onboardingTable = env.DYNAMODB_ONBOARDING_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const now = () => new Date();
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName });

const savedArticleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger: consoleLogger,
	now,
});
const crawlStore = initDynamoDbArticleCrawl({ client: dynamoClient, tableName: articlesTable, now });
const summaryStore = initDynamoDbGeneratedSummary({ client: dynamoClient, tableName: articlesTable, now });
const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const onboardingSignals = initOnboardingSignals({ client: dynamoClient, onboardingTableName: onboardingTable, now });
const { putTierSource } = initPutTierSource({ client: s3Client, bucketName: contentBucketName });

export const handler = initSaveEmailIssueCommandHandler({
	readEmailBody: initS3ReadContent({
		send: (command) => s3Client.send(command),
		readContentLocation: async (id) => ({ bucket: contentBucketName, key: id.toS3ContentKey() }),
	}),
	saveEmailIssue: initSaveEmailIssue({
		allocateSavedAt: savedArticleStore.allocateSavedAt,
		saveArticle: savedArticleStore.saveArticle,
		setDisplayUrl: canonicalAliasStore.setDisplayUrl,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		markCrawlPending: crawlStore.markCrawlPending,
		markSummaryPending: summaryStore.markSummaryPending,
		fileArticleIntoReadlist: initFileArticleIntoReadlist({
			allocateSavedAt: savedArticleStore.allocateSavedAt,
			saveReadlistArticle: savedArticleStore.saveReadlistArticle,
			updateArticleStatusAcrossReadlists: savedArticleStore.updateArticleStatusAcrossReadlists,
		}),
	}),
	putTierSource,
	recordInboxArticleQueued: onboardingSignals.recordInboxArticleQueued,
	publishEvent,
	now,
	logger: consoleLogger,
});
