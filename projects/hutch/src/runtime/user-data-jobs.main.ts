/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { DeleteAccountCommand, ExportUserDataCommand } from "@packages/hutch-infra-components";
import { requireEnv } from "@packages/require-env";
import { initCreateAppleClientSecret } from "./providers/apple-auth/apple-client-secret";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initRevokeAllUserOAuthTokens } from "./providers/oauth/dynamodb-oauth-model";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initOnboardingSignals } from "@packages/onboarding-signals";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initS3UserDataExport } from "./providers/user-data-export/s3-user-data-export";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initDynamoDbPasswordReset } from "./providers/password-reset/dynamodb-password-reset";
import { initDynamoDbEmailVerification } from "./providers/email-verification/dynamodb-email-verification";
import { initDynamoDbPendingSignup } from "./providers/pending-signup/dynamodb-pending-signup";
import { initRevokeExternalIdpTokens } from "./delete-account/revoke-external-idp-tokens";
import { initDeleteAccountHandler } from "./delete-account/delete-account-handler";
import { initExportUserDataHandler } from "./export-user-data/export-user-data-handler";
import { initHandleByDetailType } from "./handle-by-detail-type";
import { initDynamoDbInboxEmail, initDynamoDbInboxEmailLink, initDynamoDbInboxSavedLink, initDynamoDbInboxAddress, initS3DeleteObjects, initS3DeleteObjectsByPrefix } from "@packages/inbox-store";
import {
	initCountOtherSaversByUrl,
	initPurgeArticleContent,
	initS3DeleteContentObjects,
	initS3ListContentKeys,
	initTombstoneArticle,
} from "@packages/article-store";

const logger = HutchLogger.from(consoleLogger);
const now = () => new Date();
const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});

const auth = initDynamoDbAuth({
	client: dynamoClient,
	usersTableName: requireEnv("DYNAMODB_USERS_TABLE"),
	sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE"),
});

const revokeAllUserOAuthTokens = initRevokeAllUserOAuthTokens({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_OAUTH_TABLE"),
});

const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_ARTICLES_TABLE"),
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
	logger,
	now: () => new Date(),
});

const digestQueue = initDynamoDbDigestQueue({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_DIGEST_QUEUE_TABLE"),
});

const readerReadyState = initDynamoDbReaderReadyState({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_READER_READY_NOTIFICATIONS_TABLE"),
});

const onboarding = initOnboardingSignals({
	client: dynamoClient,
	onboardingTableName: requireEnv("DYNAMODB_ONBOARDING_TABLE"),
	now,
});

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE"),
	now,
});

const stripeSubscriptions = initStripeSubscriptions({
	apiKey: requireEnv("STRIPE_SECRET_KEY"),
	fetch: globalThis.fetch,
});

const trialScheduler = initAwsTrialScheduler({
	client: new SchedulerClient({}),
	scheduleGroupName: requireEnv("TRIAL_SCHEDULER_GROUP_NAME"),
	schedulerRoleArn: requireEnv("TRIAL_SCHEDULER_ROLE_ARN"),
	eventBusArn: requireEnv("EVENT_BUS_ARN"),
});

const inboxEmail = initDynamoDbInboxEmail({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_INBOX_EMAILS_TABLE"),
});

const inboxEmailLink = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE"),
});

const inboxSavedLink = initDynamoDbInboxSavedLink({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_INBOX_SAVED_LINKS_TABLE"),
	now,
});

const inboxAddress = initDynamoDbInboxAddress({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE"),
	now,
});

const deleteRawEmailObjects = initS3DeleteObjects({
	client: s3Client,
	bucketName: requireEnv("RAW_EMAIL_BUCKET_NAME"),
});

const deleteEmailContentObjects = initS3DeleteObjects({
	client: s3Client,
	bucketName: requireEnv("CONTENT_BUCKET_NAME"),
});

const deleteEmailImageObjects = initS3DeleteObjectsByPrefix({
	client: s3Client,
	bucketName: requireEnv("CONTENT_BUCKET_NAME"),
});

const { uploadUserDataExport, deleteUserExports } = initS3UserDataExport({
	client: s3Client,
	bucketName: requireEnv("USER_EXPORT_BUCKET_NAME"),
	now,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: requireEnv("EVENT_BUS_NAME"),
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(requireEnv("RESEND_API_KEY")),
	logger,
});

const passwordReset = initDynamoDbPasswordReset({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_PASSWORD_RESET_TOKENS_TABLE"),
});

const emailVerification = initDynamoDbEmailVerification({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_VERIFICATION_TOKENS_TABLE"),
});

const pendingSignup = initDynamoDbPendingSignup({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_PENDING_SIGNUPS_TABLE"),
	logger,
});

const appleClientId = requireEnv("APPLE_LOGIN_CLIENT_ID");
const applePrivateKeyPem = Buffer.from(requireEnv("APPLE_LOGIN_PRIVATE_KEY_BASE64"), "base64").toString("utf8");
assert(applePrivateKeyPem.includes("BEGIN PRIVATE KEY"), "APPLE_LOGIN_PRIVATE_KEY_BASE64 must decode to a PKCS#8 PEM");

const articlesTableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");

const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
	client: dynamoClient,
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
});

const { purgeArticleContent } = initPurgeArticleContent({
	listContentKeys: initS3ListContentKeys({ client: s3Client, bucketName: contentBucketName }).listContentKeys,
	deleteContentObjects: initS3DeleteContentObjects({ client: s3Client, bucketName: contentBucketName }).deleteContentObjects,
});

const { tombstoneArticle } = initTombstoneArticle({
	client: dynamoClient,
	tableName: articlesTableName,
});

const revokeExternalIdpTokens = initRevokeExternalIdpTokens({
	findAppleRefreshTokenByUserId: auth.findAppleRefreshTokenByUserId,
	appleClientId,
	createAppleClientSecret: initCreateAppleClientSecret({
		teamId: requireEnv("APPLE_LOGIN_TEAM_ID"),
		clientId: appleClientId,
		keyId: requireEnv("APPLE_LOGIN_KEY_ID"),
		privateKeyPem: applePrivateKeyPem,
		now,
	}),
	fetch: globalThis.fetch,
	logger,
});

export const handler = initHandleByDetailType({
	routes: {
		[DeleteAccountCommand.detailType]: [
			initDeleteAccountHandler({
				findEmailByUserId: auth.findEmailByUserId,
				findSubscriptionByUserId: subscriptionProviders.findByUserId,
				deleteBillingCustomer: stripeSubscriptions.deleteCustomer,
				deleteSubscription: subscriptionProviders.deleteSubscription,
				deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
				deleteDeferredCancellationSchedule: trialScheduler.deleteDeferredCancellationSchedule,
				deleteTrialFeedbackEmailSchedule: trialScheduler.deleteTrialFeedbackEmailSchedule,
				deleteTrialReminderSchedule: trialScheduler.deleteTrialReminderSchedule,
				deleteChargeReminderSchedule: trialScheduler.deleteChargeReminderSchedule,
				listInboxDeletionReferences: inboxEmail.listDeletionReferencesByUserId,
				deleteAllInboxEmails: inboxEmail.deleteAllEmailsByUserId,
				deleteAllInboxLinks: inboxEmailLink.deleteAllLinksByUserId,
				deleteAllInboxSavedLinks: inboxSavedLink.deleteAllByUserId,
				tombstoneInboxAddresses: inboxAddress.tombstoneUserAddresses,
				deleteRawEmailObjects,
				deleteEmailContentObjects,
				deleteEmailImageObjects,
				deleteAllUserArticles: articleStore.deleteAllUserArticles,
				listUserArticleUrls: articleStore.listUserArticleUrls,
				countOtherSaversByUrl,
				purgeArticleContent,
				tombstoneArticle,
				now,
				deleteDigestByUser: digestQueue.deleteDigestByUser,
				deleteReaderReadyState: readerReadyState.deleteReaderReadyState,
				deleteOnboarding: onboarding.deleteOnboarding,
				deleteUserExports,
				deletePasswordResetTokensByEmail: passwordReset.deleteTokensByEmail,
				deleteVerificationTokensByUserId: emailVerification.deleteTokensByUserId,
				deletePendingSignupsByUser: pendingSignup.deleteByUser,
				revokeExternalIdpTokens,
				revokeAllUserOAuthTokens,
				destroyUserSessions: auth.destroyUserSessions,
				closeUserAccount: auth.closeUserAccount,
				logger,
			}),
		],
		[ExportUserDataCommand.detailType]: [
			initExportUserDataHandler({
				findArticlesByUser: articleStore.findArticlesByUser,
				uploadUserDataExport,
				sendEmail,
				publishEvent,
				logger,
				now,
			}),
		],
	},
	logger,
});
/* c8 ignore stop */
