import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { initCatalogNewsletterDetector } from "@packages/domain/newsletter-catalog";
import {
	CheckGmailNewslettersCommand,
	MonitorGmailNewslettersCommand,
	SendGmailNewsletterNoticeCommand,
} from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailDiscovery,
	initDynamoDbGmailMonitoring,
	initDynamoDbGmailMapping,
} from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initGmailNewsletterMonitorHandler } from "./domain/gmail/gmail-newsletter-monitor-handler";
import { initMonitorGmailNewsletters } from "./domain/gmail/monitor-gmail-newsletters";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailMailbox } from "./providers/gmail-api/gmail-mailbox";
import { NEWSLETTER_CATALOG_OBJECT_KEY, initS3NewsletterCatalog } from "./providers/newsletter-catalog/s3-newsletter-catalog";

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const sqsClient = new SQSClient({});
const queueUrl = requireEnv("GMAIL_NEWSLETTER_MONITOR_QUEUE_URL");
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const credentials = initDynamoDbGmailCredentials({ client, tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"), now });
const connections = initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now });
const discovery = initDynamoDbGmailDiscovery({ client, tableName: requireEnv("DYNAMODB_GMAIL_DISCOVERY_TABLE"), now });
const monitoring = initDynamoDbGmailMonitoring({ client, tableName: requireEnv("DYNAMODB_GMAIL_MONITORING_TABLE"), now });
const mappings = initDynamoDbGmailMapping({ client, tableName: requireEnv("DYNAMODB_GMAIL_MAPPINGS_TABLE"), now });
const catalog = initS3NewsletterCatalog({ client: new S3Client({}), bucketName: requireEnv("NEWSLETTER_CATALOG_BUCKET_NAME"), key: NEWSLETTER_CATALOG_OBJECT_KEY, logger });
const mailbox = initGmailMailbox({
	accessToken: initGmailAccessToken({ clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"), clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"), credentials, fetch: globalThis.fetch, now, logger }),
	fetch: globalThis.fetch,
});

export const handler = initGmailNewsletterMonitorHandler({
	monitor: initMonitorGmailNewsletters({ mailbox, connections, discovery, monitoring, mappings, detectNewsletters: initCatalogNewsletterDetector(catalog), newGeneration: randomUUID, now }),
	listConnectedAccounts: connections.listConnectedPage,
	dispatchCheck: initSqsCommandDispatcher({ sqsClient, queueUrl, command: CheckGmailNewslettersCommand }).dispatch,
	dispatchMonitor: initSqsCommandDispatcher({ sqsClient, queueUrl, command: MonitorGmailNewslettersCommand }).dispatch,
	dispatchNotice: initSqsCommandDispatcher({ sqsClient, queueUrl: requireEnv("GMAIL_NEWSLETTER_NOTICE_QUEUE_URL"), command: SendGmailNewsletterNoticeCommand }).dispatch,
	publishEvent,
	logger,
});
