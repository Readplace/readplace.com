/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initDynamoDbGeneratedSummary } from "@packages/article-store";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initSendUserDigestHandler } from "./send-user-digest/send-user-digest-handler";
import { requireEnv } from "@packages/require-env";

/** Dedupe cooldown for the per-user digest slot. Set below the 6h flush cadence
 * so it guards a redriven/concurrent flush of the same tick without suppressing
 * the next legitimate tick.
 *
 * It must also stay far above the queue's redrive envelope —
 * `visibilityTimeoutSeconds` × `maxReceiveCount` on the send-user-digest queue,
 * about six minutes. That gap is what makes a message's own claim impossible to
 * displace before its last receive, so a redriven message always recognises its
 * own claim instead of finding the slot free and sending a second copy. */
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
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();

const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
	now: () => new Date(),
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

const summaryStore = initDynamoDbGeneratedSummary({
	client: dynamoClient,
	tableName: articlesTable,
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(resendApiKey),
	logger,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initSendUserDigestHandler({
	findUserContactByUserId: auth.findUserContactByUserId,
	listDigestItemsByUser: digestQueue.listDigestItemsByUser,
	findUserArticleNotificationState: articleStore.findUserArticleNotificationState,
	findArticleByUrl: articleStore.findArticleByUrl,
	findGeneratedSummary: summaryStore.findGeneratedSummary,
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
