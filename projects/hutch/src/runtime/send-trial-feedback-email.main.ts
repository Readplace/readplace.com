import { initAuthDiagnosticRecorder } from "./auth-diagnostics/record";
/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initSendTrialFeedbackEmailHandler } from "./send-trial-feedback-email/send-trial-feedback-email-handler";
import { initEmitLifecycleEmailSent, type LifecycleEmailSentEvent } from "./observability/lifecycle-email-events";
import { readEnv } from "@packages/require-env";
import { initQueueDigestUnsubscribeToken } from "./domain/email/queue-digest-unsubscribe-token";
import { SEND_TRIAL_FEEDBACK_EMAIL_ENV } from "./send-trial-feedback-email.env";

const env = readEnv(SEND_TRIAL_FEEDBACK_EMAIL_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const usersTable = env.DYNAMODB_USERS_TABLE;
const sessionsTable = env.DYNAMODB_SESSIONS_TABLE;
const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;
const resendApiKey = env.RESEND_API_KEY;
const staticBaseUrl = env.STATIC_BASE_URL;
const appOrigin = env.APP_ORIGIN;

const dynamoClient = createDynamoDocumentClient();

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const auth = initDynamoDbAuth({
	observeSession: initAuthDiagnosticRecorder({ salt: env.ANALYTICS_SALT, now: () => new Date(), logger: Logger.fromJSON<Record<string, unknown>>() }).observeSession,
	client: dynamoClient,
	usersTableName: usersTable,
	sessionsTableName: sessionsTable,
});

const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger: Logger.from(consoleLogger),
	now: () => new Date(),
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(resendApiKey),
	logger: Logger.from(consoleLogger),
});

export const handler = initSendTrialFeedbackEmailHandler({
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	findEmailByUserId: auth.findEmailByUserId,
	findArticlesByUser: articleStore.findArticlesByUser,
	markTrialFeedbackEmailSent: subscriptionProviders.markTrialFeedbackEmailSent,
	markTrialReminderEmailSent: subscriptionProviders.markTrialReminderEmailSent,
	markAutomationSavesHeldEmailSent: subscriptionProviders.markAutomationSavesHeldEmailSent,
	claimTrialNudge: subscriptionProviders.claimTrialNudge,
	releaseTrialNudge: subscriptionProviders.releaseTrialNudge,
	findUserContactByUserId: auth.findUserContactByUserId,
	signUnsubscribeToken: initQueueDigestUnsubscribeToken(env.ANALYTICS_SALT).sign,
	sendEmail,
	founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
	appOrigin,
	now: () => new Date(),
	logger: Logger.from(consoleLogger),
	emitLifecycleEmailSent: initEmitLifecycleEmailSent({
		logger: Logger.fromJSON<LifecycleEmailSentEvent>(),
		now: () => new Date(),
	}),
});
/* c8 ignore stop */
