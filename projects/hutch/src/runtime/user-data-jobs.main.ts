import { initAuthDiagnosticRecorder } from "./auth-diagnostics/record";
/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initMediaObjectStore } from "@packages/media-object-store";
import { Logger, consoleLogger } from "@packages/logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initHandleByDetailType,
} from "@packages/infra-components/runtime";
import { DeleteAccountCommand, ExportUserDataCommand } from "@packages/infra-components";
import { readEnv } from "@packages/require-env";
import { initCreateAppleClientSecret } from "./providers/apple-auth/apple-client-secret";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initRevokeAllUserOAuthTokens } from "./providers/oauth/dynamodb-oauth-model";
import {
	initDynamoDbEngagementStarter,
	initDynamoDbReadlistDefinitions,
	initDynamoDbSavedArticleStore,
} from "@packages/article-store";
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
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./media-release/private-item-release-steps";
import { initReleasePrivateItems } from "./media-release/release-private-items";
import { initCancelGmailHistoryImports } from "./domain/gmail/cancel-gmail-history-imports";
import { initDisconnectGmail } from "./domain/gmail/disconnect-gmail";
import { initRewriteGmailFilter } from "./domain/gmail/rewrite-gmail-filter";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailFilters } from "./providers/gmail-api/gmail-filters";
import { initRevokeGmailGrant } from "./providers/gmail-api/gmail-revoke";
import { initExportUserDataHandler } from "./export-user-data/export-user-data-handler";
import { initDynamoDbInboxEmail, initDynamoDbInboxEmailLink, initDynamoDbInboxSavedLink, initDynamoDbInboxAddress, initS3DeleteObjects, initS3DeleteObjectsByPrefix } from "@packages/inbox-store";
import { initDynamoDbGmailDiscovery, initDynamoDbGmailMonitoring, initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailHistoryImport, initDynamoDbGmailMapping, initDynamoDbGmailSender, initDynamoDbEmailIdentity } from "@packages/inbox-store";
import {
	initCountOtherSaversByUrl,
	initDeleteArticleRow,
	initDeleteUserArticleLinks,
	initDynamoDbFindItemOwner,
	initPurgeArticleContent,
	initS3DeleteContentObjects,
	initS3ListContentKeys,
	initTombstoneArticle,
} from "@packages/article-store";
import { USER_DATA_JOBS_ENV } from "./user-data-jobs.env";

const env = readEnv(USER_DATA_JOBS_ENV);

const logger = Logger.from(consoleLogger);
const now = () => new Date();
const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});

const auth = initDynamoDbAuth({
	observeSession: initAuthDiagnosticRecorder({ salt: env.ANALYTICS_SALT, now: () => new Date(), logger: Logger.fromJSON<Record<string, unknown>>() }).observeSession,
	client: dynamoClient,
	usersTableName: env.DYNAMODB_USERS_TABLE,
	sessionsTableName: env.DYNAMODB_SESSIONS_TABLE,
});

const revokeAllUserOAuthTokens = initRevokeAllUserOAuthTokens({
	secret: env.ANALYTICS_SALT,
	client: dynamoClient,
	tableName: env.DYNAMODB_OAUTH_TABLE,
});

const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: env.DYNAMODB_ARTICLES_TABLE,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
	logger,
	now: () => new Date(),
});

const engagementState = initDynamoDbEngagementStarter({
	client: dynamoClient,
	onboardingTableName: env.DYNAMODB_ONBOARDING_TABLE,
	notificationsTableName: env.DYNAMODB_READER_READY_NOTIFICATIONS_TABLE,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});
const readlistDefinitions = initDynamoDbReadlistDefinitions({
	client: dynamoClient,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});

const readerReadyState = initDynamoDbReaderReadyState({
	client: dynamoClient,
	tableName: env.DYNAMODB_READER_READY_NOTIFICATIONS_TABLE,
});

const onboarding = initOnboardingSignals({
	client: dynamoClient,
	onboardingTableName: env.DYNAMODB_ONBOARDING_TABLE,
	now,
});

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: dynamoClient,
	tableName: env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE,
	now,
});

const stripeSubscriptions = initStripeSubscriptions({
	apiKey: env.STRIPE_SECRET_KEY,
	fetch: globalThis.fetch,
});

const trialScheduler = initAwsTrialScheduler({
	client: new SchedulerClient({}),
	scheduleGroupName: env.TRIAL_SCHEDULER_GROUP_NAME,
	schedulerRoleArn: env.TRIAL_SCHEDULER_ROLE_ARN,
	eventBusArn: env.EVENT_BUS_ARN,
});

const inboxEmail = initDynamoDbInboxEmail({
	client: dynamoClient,
	tableName: env.DYNAMODB_INBOX_EMAILS_TABLE,
});

const inboxEmailLink = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE,
});

const inboxSavedLink = initDynamoDbInboxSavedLink({
	client: dynamoClient,
	tableName: env.DYNAMODB_INBOX_SAVED_LINKS_TABLE,
	now,
});

const inboxAddress = initDynamoDbInboxAddress({
	client: dynamoClient,
	tableName: env.DYNAMODB_INBOX_ADDRESSES_TABLE,
	now,
});

const deleteRawEmailObjects = initS3DeleteObjects({
	client: s3Client,
	bucketName: env.RAW_EMAIL_BUCKET_NAME,
});

const deleteRawEmailObjectsByPrefix = initS3DeleteObjectsByPrefix({
	client: s3Client,
	bucketName: env.RAW_EMAIL_BUCKET_NAME,
});

const deleteEmailContentObjects = initS3DeleteObjects({
	client: s3Client,
	bucketName: env.CONTENT_BUCKET_NAME,
});

const deleteEmailImageObjects = initS3DeleteObjectsByPrefix({
	client: s3Client,
	bucketName: env.CONTENT_BUCKET_NAME,
});

const { uploadUserDataExport, deleteUserExports } = initS3UserDataExport({
	client: s3Client,
	bucketName: env.USER_EXPORT_BUCKET_NAME,
	now,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(env.RESEND_API_KEY),
	logger,
});

const passwordReset = initDynamoDbPasswordReset({
	client: dynamoClient,
	tableName: env.DYNAMODB_PASSWORD_RESET_TOKENS_TABLE,
});

const emailVerification = initDynamoDbEmailVerification({
	client: dynamoClient,
	tableName: env.DYNAMODB_VERIFICATION_TOKENS_TABLE,
});

const pendingSignup = initDynamoDbPendingSignup({
	client: dynamoClient,
	tableName: env.DYNAMODB_PENDING_SIGNUPS_TABLE,
	logger,
});

const appleClientId = env.APPLE_LOGIN_CLIENT_ID;
const applePrivateKeyPem = Buffer.from(env.APPLE_LOGIN_PRIVATE_KEY_BASE64, "base64").toString("utf8");
assert(applePrivateKeyPem.includes("BEGIN PRIVATE KEY"), "APPLE_LOGIN_PRIVATE_KEY_BASE64 must decode to a PKCS#8 PEM");

const articlesTableName = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;

const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
	client: dynamoClient,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});

const { purgeArticleContent } = initPurgeArticleContent({
	listContentKeys: initS3ListContentKeys({ client: s3Client, bucketName: contentBucketName }).listContentKeys,
	deleteContentObjects: initS3DeleteContentObjects({ client: s3Client, bucketName: contentBucketName }).deleteContentObjects,
});

const { tombstoneArticle } = initTombstoneArticle({
	client: dynamoClient,
	tableName: articlesTableName,
});

const releasePrivateItems = initReleasePrivateItems({
	releasePrivateItem: initReleasePrivateItem({
		findItemOwner: initDynamoDbFindItemOwner({ client: dynamoClient, tableName: articlesTableName }).findItemOwner,
		steps: initPrivateItemReleaseSteps({
			purgeArticleContent,
			deleteMediaObjects: initS3DeleteContentObjects({ client: s3Client, bucketName: env.MEDIA_BUCKET_NAME })
				.deleteContentObjects,
			listMediaKeys: initS3ListContentKeys({ client: s3Client, bucketName: env.MEDIA_BUCKET_NAME })
				.listContentKeys,
			deleteArticleRow: initDeleteArticleRow({ client: dynamoClient, tableName: articlesTableName }).deleteArticleRow,
			mediaObjects: initMediaObjectStore({
				client: dynamoClient,
				tableName: env.MEDIA_TABLE_NAME,
				s3: s3Client,
				bucketName: env.MEDIA_BUCKET_NAME,
			}),
			deleteUserArticleLinks: initDeleteUserArticleLinks({
				client: dynamoClient,
				tableName: env.DYNAMODB_USER_ARTICLES_TABLE,
			}).deleteUserArticleLinks,
		}),
	}),
});

const revokeExternalIdpTokens = initRevokeExternalIdpTokens({
	findAppleRefreshTokenByUserId: auth.findAppleRefreshTokenByUserId,
	appleClientId,
	createAppleClientSecret: initCreateAppleClientSecret({
		teamId: env.APPLE_LOGIN_TEAM_ID,
		clientId: appleClientId,
		keyId: env.APPLE_LOGIN_KEY_ID,
		privateKeyPem: applePrivateKeyPem,
		now,
	}),
	fetch: globalThis.fetch,
	logger,
});

const gmailConnections = initDynamoDbGmailConnection({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE, now });
const gmailCredentials = initDynamoDbGmailCredentials({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_CREDENTIALS_TABLE, now });
const gmailSenders = initDynamoDbGmailSender({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_SENDERS_TABLE, now });
const gmailDiscovery = initDynamoDbGmailDiscovery({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_DISCOVERY_TABLE, now });
const gmailHistoryImports = initDynamoDbGmailHistoryImport({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE });
const gmailMappings = initDynamoDbGmailMapping({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_MAPPINGS_TABLE, now });
const gmailMonitoring = initDynamoDbGmailMonitoring({ client: dynamoClient, tableName: env.DYNAMODB_GMAIL_MONITORING_TABLE, now });
const emailIdentities = initDynamoDbEmailIdentity({ client: dynamoClient, tableName: env.DYNAMODB_INBOX_EMAIL_IDENTITIES_TABLE });

const disconnectGmail = initDisconnectGmail({
	connections: gmailConnections,
	credentials: gmailCredentials,
	senders: gmailSenders,
	discovery: gmailDiscovery,
	addresses: inboxAddress,
	removeGmailFilter: initRewriteGmailFilter({
		filters: initGmailFilters({
			accessToken: initGmailAccessToken({
				clientId: env.GMAIL_INTEGRATION_CLIENT_ID,
				clientSecret: env.GMAIL_INTEGRATION_CLIENT_SECRET,
				credentials: gmailCredentials,
				fetch: globalThis.fetch,
				now,
				logger,
			}),
			fetch: globalThis.fetch,
		}),
		connections: gmailConnections,
		mappings: { listMappings: async () => [] },
		addresses: inboxAddress,
		now,
		logger,
	}),
	revokeGmailGrant: initRevokeGmailGrant({ fetch: globalThis.fetch }),
	cancelGmailHistoryImports: initCancelGmailHistoryImports({ imports: gmailHistoryImports, now }),
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
				deleteTrialNudgeSchedule: trialScheduler.deleteTrialNudgeSchedule,
				listInboxDeletionReferences: inboxEmail.listDeletionReferencesByUserId,
				deleteAllInboxEmails: inboxEmail.deleteAllEmailsByUserId,
				deleteAllInboxLinks: inboxEmailLink.deleteAllLinksByUserId,
				deleteAllInboxSavedLinks: inboxSavedLink.deleteAllByUserId,
				tombstoneInboxAddresses: inboxAddress.tombstoneUserAddresses,
				deleteReadlistAddressClaims: inboxAddress.deleteReadlistAddressClaims,
				deleteAllGmailHistoryImports: gmailHistoryImports.deleteAllByUserId,
				deleteAllGmailMonitoring: gmailMonitoring.deleteAllByUserId,
				deleteAllGmailMappings: gmailMappings.deleteAllByUserId,
				deleteAllEmailIdentities: emailIdentities.deleteAllByUserId,
				disconnectGmail,
				deleteRawEmailObjects,
				deleteRawEmailObjectsByPrefix,
				deleteEmailContentObjects,
				deleteEmailImageObjects,
				deleteAllUserArticles: articleStore.deleteAllUserArticles,
				listUserArticleUrls: articleStore.listUserArticleUrls,
				countOtherSaversByUrl,
				purgeArticleContent,
				tombstoneArticle,
				releasePrivateItems,
				now,
				withdrawStarterAssignment: engagementState.withdrawStarterAssignment,
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
				engagementState,
				listReadlistDefinitions: readlistDefinitions.listReadlistDefinitions,
				findArticlesAcrossReadlists: articleStore.findArticlesAcrossReadlists,
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
