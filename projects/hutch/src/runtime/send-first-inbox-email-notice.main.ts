import { initAuthDiagnosticRecorder } from "./auth-diagnostics/record";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initOnboardingSignals } from "@packages/onboarding-signals";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initSendFirstInboxEmailNoticeHandler } from "./send-first-inbox-email-notice/send-first-inbox-email-notice-handler";
import { readEnv } from "@packages/require-env";
import { SEND_FIRST_INBOX_EMAIL_NOTICE_ENV } from "./send-first-inbox-email-notice.env";

const env = readEnv(SEND_FIRST_INBOX_EMAIL_NOTICE_ENV);

const usersTable = env.DYNAMODB_USERS_TABLE;
const sessionsTable = env.DYNAMODB_SESSIONS_TABLE;
const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;
const onboardingTable = env.DYNAMODB_ONBOARDING_TABLE;
const resendApiKey = env.RESEND_API_KEY;
const staticBaseUrl = env.STATIC_BASE_URL;
const appOrigin = env.APP_ORIGIN;

const dynamoClient = createDynamoDocumentClient();

const { findByUserId } = initDynamoDbSubscriptionRead({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
});

const auth = initDynamoDbAuth({
	observeSession: initAuthDiagnosticRecorder({ salt: env.ANALYTICS_SALT, now: () => new Date(), logger: Logger.fromJSON<Record<string, unknown>>() }).observeSession,
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
	logger: Logger.from(consoleLogger),
});

export const handler = initSendFirstInboxEmailNoticeHandler({
	findSubscriptionByUserId: findByUserId,
	findEmailByUserId: auth.findEmailByUserId,
	markFirstInboxEmailNoticeSent: onboardingSignals.markFirstInboxEmailNoticeSent,
	sendEmail,
	founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
	appOrigin,
	now: () => new Date(),
	logger: Logger.from(consoleLogger),
});
