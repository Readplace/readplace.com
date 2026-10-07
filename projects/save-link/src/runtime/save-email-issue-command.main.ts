import { S3Client } from "@aws-sdk/client-s3";
import {
	initCanonicalAliasStore,
	initDynamoDbArticleCrawl,
	initDynamoDbGeneratedSummary,
	initDynamoDbSavedArticleStore,
	initS3ReadContent,
} from "@packages/article-store";
import { QueueEntryCreatedEvent } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initOnboardingSignals } from "@packages/onboarding-signals";
import { requireEnv } from "@packages/require-env";
import { initFileArticleIntoReadlist } from "@packages/save-article";
import { initSaveEmailIssue } from "./domain/save-email-issue/save-email-issue";
import { initSaveEmailIssueCommandHandler } from "./domain/save-email-issue/save-email-issue-command-handler";
import { initPutTierSource } from "./providers/article-store/put-tier-source";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const onboardingTable = requireEnv("DYNAMODB_ONBOARDING_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");

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
		publishQueueEntryCreated: (params) => publishEvent(QueueEntryCreatedEvent, params),
	}),
	putTierSource,
	recordInboxArticleQueued: onboardingSignals.recordInboxArticleQueued,
	publishEvent,
	now,
	logger: consoleLogger,
});
