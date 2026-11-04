/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
	initDynamoDbArticleCrawl,
	initDynamoDbEngagementStarter,
	initDynamoDbSavedArticleStore,
	initDynamoDbGeneratedSummary,
	initCanonicalAliasStore,
	initDynamoDbFindItemOwner,
	initReadArticleContent,
	initReadContentLocation,
	initS3ReadContent,
} from "@packages/article-store";
import {
	initResolveSaveIdentity,
	initStartAnonymousCrawl,
	neverResolveWrapperTarget,
} from "@packages/save-article";
import { validateSaveableUrl, withNewSavePreparation } from "@packages/domain/article";
import { SaveAnonymousLinkCommand } from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { initS3HnSnapshot } from "./providers/hn-snapshot/s3-hn-snapshot";
import { initS3StarterRollout } from "./providers/hn-snapshot/s3-starter-rollout";
import { initHnSnapshot } from "./domain/engagement/hn-snapshot";
import { initPrepareStarterSnapshot } from "./domain/engagement/prepare-starter-snapshot";
import { initStarterReport } from "./domain/engagement/starter-report";
import {
	initLogStarterReport,
	type StarterReportLine,
} from "./domain/engagement/log-starter-report";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { SendUserDigestCommand } from "@packages/infra-components";
import { initSqsCommandDispatcher } from "@packages/infra-components/runtime";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDigestScanHandler } from "./digest-scan/digest-scan-handler";
import { readEnv } from "@packages/require-env";
import { DIGEST_SCAN_ENV } from "./digest-scan.env";

const env = readEnv(DIGEST_SCAN_ENV);

const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;
const sendUserDigestQueueUrl = env.SEND_USER_DIGEST_QUEUE_URL;

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});

const { listUserIdsByStatus } = initDynamoDbSubscriptionRead({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
});

const { dispatch: dispatchSendUserDigest } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: sendUserDigestQueueUrl,
	command: SendUserDigestCommand,
});

const logger = Logger.from(consoleLogger);
const s3 = new S3Client({});
const contentBucketName = env.CONTENT_BUCKET_NAME;
const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
	now: () => new Date(),
});
const summaries = initDynamoDbGeneratedSummary({
	client: dynamoClient,
	tableName: articlesTable,
	now: () => new Date(),
});
const aliases = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const crawlStore = initDynamoDbArticleCrawl({
	client: dynamoClient,
	tableName: articlesTable,
	now: () => new Date(),
});
const rollout = initS3StarterRollout({
	bucketName: contentBucketName,
	get: (command) => s3.send(command),
	put: (command) => s3.send(command),
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});
const { prepareSnapshot } = initHnSnapshot({
	store: initS3HnSnapshot({
		bucketName: contentBucketName,
		get: (command) => s3.send(command),
		put: (command) => s3.send(command),
	}),
	fetch: globalThis.fetch,
	validateSaveableUrl: withNewSavePreparation(validateSaveableUrl),
	resolveSaveIdentity: initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: aliases.findIdentityRow,
		claimAlias: aliases.claimAlias,
		resolveWrapperTarget: neverResolveWrapperTarget,
		now: () => new Date(),
	}),
	findArticleByUrl: articleStore.findArticleByUrl,
	findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
	readArticleContent: initReadArticleContent({
		storageProviderQueryOrder: [
			initS3ReadContent({
				send: (command) => s3.send(command),
				readContentLocation: initReadContentLocation({ client: dynamoClient, tableName: articlesTable, bucketName: contentBucketName }),
			}),
			articleStore.readContent,
		],
		findItemOwner: initDynamoDbFindItemOwner({ client: dynamoClient, tableName: articlesTable }).findItemOwner,
		logError: (message, error) => logger.error(message, { error }),
	}),
	findGeneratedSummary: summaries.findGeneratedSummary,
	startAnonymousCrawl: initStartAnonymousCrawl({
		saveArticleGlobally: articleStore.saveArticleGlobally,
		pinContentSource: aliases.pinContentSource,
		markCrawlPending: crawlStore.markCrawlPending,
		markSummaryPending: summaries.markSummaryPending,
		publishSaveAnonymousLink: async (detail) => {
			await publishEvent(SaveAnonymousLinkCommand, detail);
		},
		now: () => new Date(),
	}),
	now: () => new Date(),
	logger,
});

export const handler = initDigestScanHandler({
	prepareStarterSnapshot: initPrepareStarterSnapshot({
		startObservation: rollout.startObservation,
		prepareSnapshot,
		deploymentSha: env.ENGAGEMENT_DEPLOYMENT_SHA,
		excludedUserIds: z
			.array(z.string())
			.parse(JSON.parse(env.ENGAGEMENT_EXCLUDED_USER_IDS)),
		now: () => new Date(),
	}),
	logStarterReport: initLogStarterReport({
		getStarterReport: initStarterReport({
			findRollout: rollout.findRollout,
			listAccounts: initDynamoDbEngagementStarter({
				client: dynamoClient,
				onboardingTableName: env.DYNAMODB_ONBOARDING_TABLE,
				notificationsTableName: env.DYNAMODB_READER_READY_NOTIFICATIONS_TABLE,
				userArticlesTableName: userArticlesTable,
			}).listStarterObservations,
			now: () => new Date(),
		}),
		logger: Logger.fromJSON<StarterReportLine>(),
		now: () => new Date(),
	}),
	listUserIdsByStatus,
	dispatchSendUserDigest,
	logger,
});
/* c8 ignore stop */
