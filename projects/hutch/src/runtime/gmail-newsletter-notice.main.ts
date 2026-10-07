import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import { initCatalogNewsletterDetector } from "@packages/domain/newsletter-catalog";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbGmailConnection, initDynamoDbGmailMapping, initDynamoDbGmailMonitoring } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initSendGmailNewsletterNoticeHandler } from "./domain/gmail/send-gmail-newsletter-notice-handler";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { NEWSLETTER_CATALOG_OBJECT_KEY, initS3NewsletterCatalog } from "./providers/newsletter-catalog/s3-newsletter-catalog";

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const monitoring = initDynamoDbGmailMonitoring({ client, tableName: requireEnv("DYNAMODB_GMAIL_MONITORING_TABLE"), now });
const connections = initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now });
const mappings = initDynamoDbGmailMapping({ client, tableName: requireEnv("DYNAMODB_GMAIL_MAPPINGS_TABLE"), now });
const catalog = initS3NewsletterCatalog({ client: new S3Client({}), bucketName: requireEnv("NEWSLETTER_CATALOG_BUCKET_NAME"), key: NEWSLETTER_CATALOG_OBJECT_KEY, logger });
const auth = initDynamoDbAuth({ client, usersTableName: requireEnv("DYNAMODB_USERS_TABLE"), sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE") });
const { sendEmail } = initSkipReservedDomain({ ...initResendEmail(requireEnv("RESEND_API_KEY")), logger });

export const handler = initSendGmailNewsletterNoticeHandler({
	monitoring,
	connections,
	mappings,
	detectNewsletters: initCatalogNewsletterDetector(catalog),
	listReadlistDefinitions: initDynamoDbReadlistDefinitions({ client, userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE") }).listReadlistDefinitions,
	findEmailByUserId: auth.findEmailByUserId,
	sendEmail,
	founderAvatarUrl: `${requireEnv("STATIC_BASE_URL")}/fayner-brack.jpg`,
	appOrigin: requireEnv("APP_ORIGIN"),
	now,
	publishEvent,
	logger,
});
