/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initResendEmail } from "./providers/email/resend-email";
import { initReaderReadyNotifyHandler } from "./reader-ready-notify/reader-ready-notify-handler";
import { requireEnv } from "@packages/require-env";

/** Hard cap: at most one reader-ready email per user per 6 hours, claimed
 * atomically on the per-user reader-ready-notifications row. Extras are dropped
 * + logged (digest is a future EPIC). */
const READER_READY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const appOrigin = requireEnv("APP_ORIGIN");
const resendApiKey = requireEnv("RESEND_API_KEY");
const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const readerReadyNotificationsTable = requireEnv("DYNAMODB_READER_READY_NOTIFICATIONS_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
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

const { sendEmail } = initResendEmail(resendApiKey);

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initReaderReadyNotifyHandler({
	findUserArticleNotificationState: articleStore.findUserArticleNotificationState,
	findArticleByUrl: articleStore.findArticleByUrl,
	findUserContactByUserId: auth.findUserContactByUserId,
	claimReaderReadyEmailSlot: readerReadyState.claimReaderReadyEmailSlot,
	releaseReaderReadyEmailSlot: readerReadyState.releaseReaderReadyEmailSlot,
	markReaderReadyEmailSent: articleStore.markReaderReadyEmailSent,
	sendEmail,
	publishEvent,
	appOrigin,
	cooldownMs: READER_READY_COOLDOWN_MS,
	now: () => new Date(),
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
