import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import { initCatalogNewsletterDetector } from "@packages/domain/newsletter-catalog";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbGmailConnection, initDynamoDbGmailMapping, initDynamoDbGmailMonitoring } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbSubscriptionRead, initGetEffectiveAccess } from "@packages/subscription-access";
import { initSendGmailNewsletterNoticeHandler } from "./domain/gmail/send-gmail-newsletter-notice-handler";
import { GmailNewsletterNoticeEmail } from "./web/auth/gmail-newsletter-notice-email";
import { GMAIL_PATH } from "./web/pages/integrations/gmail.url";
import { initDynamoDbUserContact } from "./providers/auth/dynamodb-auth";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initS3NewsletterCatalog } from "./providers/newsletter-catalog/s3-newsletter-catalog";

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = Logger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const monitoring = initDynamoDbGmailMonitoring({ client, tableName: requireEnv("DYNAMODB_GMAIL_MONITORING_TABLE"), now });
const connections = initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now });
const mappings = initDynamoDbGmailMapping({ client, tableName: requireEnv("DYNAMODB_GMAIL_MAPPINGS_TABLE"), now });
const catalog = initS3NewsletterCatalog({ client: new S3Client({}), bucketName: requireEnv("NEWSLETTER_CATALOG_BUCKET_NAME"), logger });
const auth = initDynamoDbUserContact({ client, usersTableName: requireEnv("DYNAMODB_USERS_TABLE") });
const { sendEmail } = initSkipReservedDomain({ ...initResendEmail(requireEnv("RESEND_API_KEY")), logger });

export const handler = initSendGmailNewsletterNoticeHandler({
	monitoring,
	connections,
	mappings,
	detectNewsletters: initCatalogNewsletterDetector(catalog),
	listReadlistDefinitions: initDynamoDbReadlistDefinitions({ client, userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE") }).listReadlistDefinitions,
	findEmailByUserId: auth.findEmailByUserId,
	getEffectiveAccess: initGetEffectiveAccess({
		findSubscriptionByUserId: initDynamoDbSubscriptionRead({ client, tableName: requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE") }).findByUserId,
		now,
	}),
	sendEmail,
	founderAvatarUrl: `${requireEnv("STATIC_BASE_URL")}/fayner-brack.jpg`,
	gmailPageUrl: new URL(GMAIL_PATH, requireEnv("APP_ORIGIN")).toString(),
	renderNewsletterNotice: GmailNewsletterNoticeEmail,
	now,
	publishEvent,
	logger,
});
