/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initSendTrialFeedbackEmailHandler } from "./send-trial-feedback-email/send-trial-feedback-email-handler";
import { requireEnv } from "@packages/require-env";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const subscriptionProvidersTable = requireEnv(
	"DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE",
);
const resendApiKey = requireEnv("RESEND_API_KEY");
const staticBaseUrl = requireEnv("STATIC_BASE_URL");
const appOrigin = requireEnv("APP_ORIGIN");

const dynamoClient = createDynamoDocumentClient();

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const auth = initDynamoDbAuth({
	client: dynamoClient,
	usersTableName: usersTable,
	sessionsTableName: sessionsTable,
});

const articleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger: HutchLogger.from(consoleLogger),
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(resendApiKey),
	logger: HutchLogger.from(consoleLogger),
});

export const handler = initSendTrialFeedbackEmailHandler({
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	findEmailByUserId: auth.findEmailByUserId,
	findArticlesByUser: articleStore.findArticlesByUser,
	markTrialFeedbackEmailSent: subscriptionProviders.markTrialFeedbackEmailSent,
	markTrialReminderEmailSent: subscriptionProviders.markTrialReminderEmailSent,
	sendEmail,
	founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
	appOrigin,
	now: () => new Date(),
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
