/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initRevokeAllUserOAuthTokens } from "./providers/oauth/dynamodb-oauth-model";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initDynamoDbReaderReadyState } from "./providers/reader-ready-state/dynamodb-reader-ready-state";
import { initIosOnboardingSignal } from "./providers/ios-onboarding-signal/dynamodb-ios-onboarding-signal";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initDynamoDbInboxEmail } from "./providers/inbox-email/dynamodb-inbox-email";
import { initDynamoDbInboxEmailLink } from "./providers/inbox-email/dynamodb-inbox-email-link";
import { initS3DeleteObjects } from "./providers/inbox-email/s3-delete-objects";
import { initDynamoDbInboxAddress } from "./providers/inbox-address/dynamodb-inbox-address";
import { initS3UserDataExport } from "./providers/user-data-export/s3-user-data-export";
import { initDynamoDbPasswordReset } from "./providers/password-reset/dynamodb-password-reset";
import { initNoopRevokeExternalIdpTokens } from "./delete-account/revoke-external-idp-tokens";
import { initDeleteAccountHandler } from "./delete-account/delete-account-handler";

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

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_ARTICLES_TABLE"),
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
	logger,
});

const digestQueue = initDynamoDbDigestQueue({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_DIGEST_QUEUE_TABLE"),
});

const readerReadyState = initDynamoDbReaderReadyState({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_READER_READY_NOTIFICATIONS_TABLE"),
});

const onboarding = initIosOnboardingSignal({
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

const { deleteUserExports } = initS3UserDataExport({
	client: s3Client,
	bucketName: requireEnv("USER_EXPORT_BUCKET_NAME"),
	now,
});

const passwordReset = initDynamoDbPasswordReset({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_PASSWORD_RESET_TOKENS_TABLE"),
});

const revokeExternalIdpTokens = initNoopRevokeExternalIdpTokens({ logger });

export const handler = initDeleteAccountHandler({
	findEmailByUserId: auth.findEmailByUserId,
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	cancelStripeSubscription: stripeSubscriptions.cancelImmediately,
	deleteStripeCustomer: stripeSubscriptions.deleteCustomer,
	deleteSubscription: subscriptionProviders.deleteSubscription,
	deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
	deleteDeferredCancellationSchedule: trialScheduler.deleteDeferredCancellationSchedule,
	deleteTrialFeedbackEmailSchedule: trialScheduler.deleteTrialFeedbackEmailSchedule,
	deleteAllInboxEmails: inboxEmail.deleteAllEmailsByUserId,
	deleteAllInboxLinks: inboxEmailLink.deleteAllLinksByUserId,
	tombstoneInboxAddresses: inboxAddress.tombstoneUserAddresses,
	deleteRawEmailObjects,
	deleteEmailContentObjects,
	deleteAllUserArticles: articleStore.deleteAllUserArticles,
	deleteDigestByUser: digestQueue.deleteDigestByUser,
	deleteReaderReadyState: readerReadyState.deleteReaderReadyState,
	deleteOnboarding: onboarding.deleteOnboarding,
	deleteUserExports,
	deletePasswordResetTokensByEmail: passwordReset.deleteTokensByEmail,
	revokeExternalIdpTokens,
	revokeAllUserOAuthTokens,
	destroyUserSessions: auth.destroyUserSessions,
	closeUserAccount: auth.closeUserAccount,
	logger,
});
/* c8 ignore stop */
