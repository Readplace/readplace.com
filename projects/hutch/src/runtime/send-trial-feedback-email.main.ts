/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initResendEmail } from "./providers/email/resend-email";
import { initSendTrialFeedbackEmailHandler } from "./send-trial-feedback-email/send-trial-feedback-email-handler";
import { requireEnv } from "./domain/require-env";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const subscriptionProvidersTable = requireEnv(
	"DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE",
);
const resendApiKey = requireEnv("RESEND_API_KEY");
const staticBaseUrl = requireEnv("STATIC_BASE_URL");

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

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const { sendEmail } = initResendEmail(resendApiKey);

export const handler = initSendTrialFeedbackEmailHandler({
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	findEmailByUserId: auth.findEmailByUserId,
	findArticlesByUser: articleStore.findArticlesByUser,
	markTrialFeedbackEmailSent: subscriptionProviders.markTrialFeedbackEmailSent,
	sendEmail,
	founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
	now: () => new Date(),
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
