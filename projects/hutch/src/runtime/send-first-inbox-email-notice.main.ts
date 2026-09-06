import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initOnboardingSignals } from "@packages/onboarding-signals";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initSendFirstInboxEmailNoticeHandler } from "./send-first-inbox-email-notice/send-first-inbox-email-notice-handler";
import { requireEnv } from "@packages/require-env";

const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
const subscriptionProvidersTable = requireEnv(
	"DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE",
);
const onboardingTable = requireEnv("DYNAMODB_ONBOARDING_TABLE");
const resendApiKey = requireEnv("RESEND_API_KEY");
const staticBaseUrl = requireEnv("STATIC_BASE_URL");
const appOrigin = requireEnv("APP_ORIGIN");

const dynamoClient = createDynamoDocumentClient();

const { findByUserId } = initDynamoDbSubscriptionRead({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
});

const auth = initDynamoDbAuth({
	client: dynamoClient,
	usersTableName: usersTable,
	sessionsTableName: sessionsTable,
});

const onboardingSignals = initOnboardingSignals({
	client: dynamoClient,
	onboardingTableName: onboardingTable,
	now: () => new Date(),
});

const { sendEmail } = initSkipReservedDomain({
	...initResendEmail(resendApiKey),
	logger: HutchLogger.from(consoleLogger),
});

export const handler = initSendFirstInboxEmailNoticeHandler({
	findSubscriptionByUserId: findByUserId,
	findEmailByUserId: auth.findEmailByUserId,
	markFirstInboxEmailNoticeSent: onboardingSignals.markFirstInboxEmailNoticeSent,
	sendEmail,
	founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
	appOrigin,
	now: () => new Date(),
	logger: HutchLogger.from(consoleLogger),
});
