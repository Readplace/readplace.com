/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initReadArticleContent } from "@packages/article-store";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initS3ReadContent } from "./providers/article-store/s3-read-content";
import { initResendEmail } from "./providers/email/resend-email";
import { initSendUserDigestHandler } from "./send-user-digest/send-user-digest-handler";
import { requireEnv } from "@packages/require-env";

/** Dedupe cooldown for the per-user digest slot. Set below the 6h flush cadence
 * so it guards a redriven/concurrent flush of the same tick without suppressing
 * the next legitimate tick. */
const DIGEST_EMAIL_COOLDOWN_MS = 5.5 * 60 * 60 * 1000;

/** Cap the articles resolved (and emailed) per digest. Bounds the per-user
 * live-state reads so a large backlog can't exceed the Lambda timeout after the
 * cooldown slot is claimed; overflow rows drain on the next 6h tick. */
const MAX_DIGEST_ITEMS = 25;

const logger = HutchLogger.from(consoleLogger);
const appOrigin = requireEnv("APP_ORIGIN");
const resendApiKey = requireEnv("RESEND_API_KEY");
const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const readerReadyNotificationsTable = requireEnv("DYNAMODB_READER_READY_NOTIFICATIONS_TABLE");
const digestQueueTable = requireEnv("DYNAMODB_DIGEST_QUEUE_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
});

const auth = initDynamoDbAuth({
	client: dynamoClient,
	usersTableName: usersTable,
	sessionsTableName: sessionsTable,
});

const readerReadyState = initDynamoDbReaderReadyState({
	client: dynamoClient,
	tableName: readerReadyNotificationsTable,
});

const digestQueue = initDynamoDbDigestQueue({
	client: dynamoClient,
	tableName: digestQueueTable,
});

const readArticleContent = initReadArticleContent({
	storageProviderQueryOrder: [
		initS3ReadContent({ send: (cmd) => s3Client.send(cmd), bucketName: contentBucketName }),
		articleStore.readContent, // Legacy fallback for articles saved before S3 migration
	],
	logError: (message, error) => logger.error(message, { error }),
});

const { sendEmail } = initResendEmail(resendApiKey);

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initSendUserDigestHandler({
	findUserContactByUserId: auth.findUserContactByUserId,
	listDigestItemsByUser: digestQueue.listDigestItemsByUser,
	findUserArticleNotificationState: articleStore.findUserArticleNotificationState,
	findArticleByUrl: articleStore.findArticleByUrl,
	readArticleContent,
	deleteDigestItem: digestQueue.deleteDigestItem,
	claimReaderReadyEmailSlot: readerReadyState.claimReaderReadyEmailSlot,
	releaseReaderReadyEmailSlot: readerReadyState.releaseReaderReadyEmailSlot,
	markReaderReadyEmailSent: articleStore.markReaderReadyEmailSent,
	sendEmail,
	publishEvent,
	appOrigin,
	cooldownMs: DIGEST_EMAIL_COOLDOWN_MS,
	maxDigestItems: MAX_DIGEST_ITEMS,
	now: () => new Date(),
	logger,
});
/* c8 ignore stop */
