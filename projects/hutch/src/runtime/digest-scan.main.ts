/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
	initDynamoDbArticleCrawl,
	initDynamoDbSavedArticleStore,
	initDynamoDbGeneratedSummary,
	initCanonicalAliasStore,
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
import { SaveAnonymousLinkCommand } from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { initS3HnSnapshot } from "./providers/hn-snapshot/s3-hn-snapshot";
import { initS3StarterRollout } from "./providers/hn-snapshot/s3-starter-rollout";
import { initHnSnapshot } from "./domain/engagement/hn-snapshot";
import { initPrepareStarterSnapshot } from "./domain/engagement/prepare-starter-snapshot";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { SendUserDigestCommand } from "@packages/hutch-infra-components";
import { initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDigestScanHandler } from "./digest-scan/digest-scan-handler";
import { requireEnv } from "@packages/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const sendUserDigestQueueUrl = requireEnv("SEND_USER_DIGEST_QUEUE_URL");

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

const logger = HutchLogger.from(consoleLogger);
const s3 = new S3Client({});
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
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
	eventBusName: requireEnv("EVENT_BUS_NAME"),
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
		deploymentSha: requireEnv("ENGAGEMENT_DEPLOYMENT_SHA"),
		excludedUserIds: z
			.array(z.string())
			.parse(JSON.parse(requireEnv("ENGAGEMENT_EXCLUDED_USER_IDS"))),
		now: () => new Date(),
	}),
	listUserIdsByStatus,
	dispatchSendUserDigest,
	logger,
});
/* c8 ignore stop */
