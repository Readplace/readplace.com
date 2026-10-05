/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { generateReadlistSlug } from "@packages/domain/readlist";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import {
	initDynamoDbEngagementStarter,
	initDynamoDbReadlistDefinitions,
} from "@packages/article-store";
import { initS3HnSnapshot } from "./providers/hn-snapshot/s3-hn-snapshot";
import { initS3StarterRollout } from "./providers/hn-snapshot/s3-starter-rollout";
import { initFindReadySnapshot } from "./domain/engagement/hn-snapshot";
import { initEnrollStarter } from "./domain/engagement/enroll-starter";
import { initSendStarter } from "./domain/engagement/send-starter";
import { initEngagementEvents, type EngagementEvent } from "./domain/engagement/engagement-events";
import { initResolveSaveAccess } from "./web/mcp/save-access";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initDynamoDbGeneratedSummary } from "@packages/article-store";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initQueueDigestUnsubscribeToken } from "./domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_INTERVAL_DAYS, QUEUE_DIGEST_MIN_SAVE_AGE_DAYS } from "./domain/email/queue-digest-cadence";
import { initEmitQueueDigestEvent, type QueueDigestLogEvent } from "./observability/queue-digest-events";
import { initSendQueueDigestHandler } from "./send-queue-digest/send-queue-digest-handler";
import { requireEnv } from "@packages/require-env";

/** Dedupe cooldown for the per-user digest slot. Set below the 6h flush cadence
 * so it guards a redriven/concurrent flush of the same tick.
 *
 * It must also stay far above the queue's redrive envelope —
 * `visibilityTimeoutSeconds` × `maxReceiveCount` on the send-user-digest queue,
 * about six minutes. That gap is what makes a message's own claim impossible to
 * displace before its last receive, so a redriven message always recognises its
 * own claim instead of finding the slot free and sending a second copy. */
const DIGEST_EMAIL_COOLDOWN_MS = 5.5 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const FLUSH_TICK_TOLERANCE_MS = 30 * 60 * 1000;

const REGULAR_DIGEST_MIN_GAP_MS = QUEUE_DIGEST_INTERVAL_DAYS * DAY_MS - FLUSH_TICK_TOLERANCE_MS;

const MIN_SAVE_AGE_MS = QUEUE_DIGEST_MIN_SAVE_AGE_DAYS * DAY_MS;

const MAX_DIGEST_ITEMS = 10;

const MAX_CANDIDATES_READ = 50;

const logger = HutchLogger.from(consoleLogger);
const appOrigin = requireEnv("APP_ORIGIN");
const resendApiKey = requireEnv("RESEND_API_KEY");
const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const readerReadyNotificationsTable = requireEnv("DYNAMODB_READER_READY_NOTIFICATIONS_TABLE");
const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const analyticsSalt = requireEnv("ANALYTICS_SALT");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const onboardingTableName = requireEnv("DYNAMODB_ONBOARDING_TABLE");
const excludedUserIds = z
	.array(z.string())
	.parse(JSON.parse(requireEnv("ENGAGEMENT_EXCLUDED_USER_IDS")));

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

const subscriptions = initDynamoDbSubscriptionProviders({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const summaryStore = initDynamoDbGeneratedSummary({
	client: dynamoClient,
	tableName: articlesTable,
	now: () => new Date(),
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(resendApiKey),
	logger,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const s3 = new S3Client({});
const rolloutStore = initS3StarterRollout({
	bucketName: contentBucketName,
	get: (command) => s3.send(command),
	put: (command) => s3.send(command),
});
const starterState = initDynamoDbEngagementStarter({
	client: dynamoClient,
	onboardingTableName,
	notificationsTableName: readerReadyNotificationsTable,
	userArticlesTableName: userArticlesTable,
});
const readlistDefinitions = initDynamoDbReadlistDefinitions({
	client: dynamoClient,
	userArticlesTableName: userArticlesTable,
});
const findReadySnapshot = initFindReadySnapshot({
	store: initS3HnSnapshot({
		bucketName: contentBucketName,
		get: (command) => s3.send(command),
		put: (command) => s3.send(command),
	}),
	now: () => new Date(),
});
const emitStarterEvent = initEngagementEvents({
	logger: HutchLogger.fromJSON<EngagementEvent>(),
	now: () => new Date(),
});
const enrollStarter = initEnrollStarter({
	state: starterState,
	findUserById: auth.findUserById,
	findUserContactByUserId: auth.findUserContactByUserId,
	getEffectiveAccess: initGetEffectiveAccess({
		findSubscriptionByUserId: subscriptions.findByUserId,
		now: () => new Date(),
	}),
	resolveSaveAccess: initResolveSaveAccess({ findUserById: auth.findUserById, now: () => new Date() }),
	findPersonalLibrary: articleStore.findPersonalLibrary,
	listReadlistDefinitions: readlistDefinitions.listReadlistDefinitions,
	findReadySnapshot,
	saveStarterPack: starterState.saveStarterPack,
	allocateSavedAtSequence: articleStore.allocateSavedAtSequence,
	newReadlistSlug: generateReadlistSlug,
	findRollout: rolloutStore.findRollout,
	excludedUserIds,
	now: () => new Date(),
	logger,
	emit: emitStarterEvent,
});
const processStarter = initSendStarter({
	state: starterState,
	findUserContactByUserId: auth.findUserContactByUserId,
	findSubscriptionByUserId: subscriptions.findByUserId,
	findReaderReadyEmailState: readerReadyState.findReaderReadyEmailState,
	findReadlistArticleById: articleStore.findReadlistArticleById,
	findArticleById: articleStore.findArticleById,
	listUserSavesForUrl: articleStore.listUserSavesForUrl,
	findArticleByUrl: articleStore.findArticleByUrl,
	findGeneratedSummary: summaryStore.findGeneratedSummary,
	sendEmail,
	signUnsubscribeToken: initQueueDigestUnsubscribeToken(analyticsSalt).sign,
	appOrigin,
	now: () => new Date(),
	emit: emitStarterEvent,
});

export const handler = initSendQueueDigestHandler({
	enrollStarter,
	processStarter,
	findUserContactByUserId: auth.findUserContactByUserId,
	findSubscriptionByUserId: subscriptions.findByUserId,
	findReaderReadyEmailState: readerReadyState.findReaderReadyEmailState,
	findUnreadSavesForDigest: articleStore.findUnreadSavesForDigest,
	findGeneratedSummary: summaryStore.findGeneratedSummary,
	claimReaderReadyEmailSlot: readerReadyState.claimReaderReadyEmailSlot,
	releaseReaderReadyEmailSlot: readerReadyState.releaseReaderReadyEmailSlot,
	claimPayDigest: subscriptions.claimPayDigest,
	releasePayDigest: subscriptions.releasePayDigest,
	markReaderReadyEmailSent: articleStore.markReaderReadyEmailSent,
	sendEmail,
	publishEvent,
	emitQueueDigestEvent: initEmitQueueDigestEvent({
		logger: HutchLogger.fromJSON<QueueDigestLogEvent>(),
		now: () => new Date(),
	}),
	signUnsubscribeToken: initQueueDigestUnsubscribeToken(analyticsSalt).sign,
	appOrigin,
	cooldownMs: DIGEST_EMAIL_COOLDOWN_MS,
	regularDigestMinGapMs: REGULAR_DIGEST_MIN_GAP_MS,
	minSaveAgeMs: MIN_SAVE_AGE_MS,
	maxDigestItems: MAX_DIGEST_ITEMS,
	maxCandidatesRead: MAX_CANDIDATES_READ,
	now: () => new Date(),
	logger,
});
/* c8 ignore stop */
