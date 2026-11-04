import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { INBOX_DLQ_SOURCE_QUEUES } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { INBOX_FAILURES_DLQ_ENV } from "./inbox-failures-dlq.env";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { initConfirmGmailForwardingDlqHandler } from "./domain/gmail/confirm-gmail-forwarding-dlq-handler";
import { initCrawlEmailLinkPreviewDlqHandler } from "./domain/inbox/crawl-email-link-preview-dlq-handler";
import { initExtractEmailLinksDlqHandler } from "./domain/inbox/extract-email-links-dlq-handler";
import { initIngestGmailImportDlqHandler } from "./domain/inbox/ingest-gmail-import-dlq-handler";

const env = readEnv(INBOX_FAILURES_DLQ_ENV);

const inboxEmailLinksTable = env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE;
const eventBusName = env.EVENT_BUS_NAME;

const logger = Logger.from(consoleLogger);
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: createDynamoDocumentClient(),
	tableName: inboxEmailLinksTable,
});
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName });

export const handler = initDeadLetterRouter({
	routes: {
		[INBOX_DLQ_SOURCE_QUEUES.extractEmailLinks]: initExtractEmailLinksDlqHandler({
			markLinksExtractionFailed: inboxEmailLinkStore.markLinksExtractionFailed,
			logger,
		}),
		[INBOX_DLQ_SOURCE_QUEUES.crawlEmailLinkPreview]: initCrawlEmailLinkPreviewDlqHandler({
			failPendingLink: inboxEmailLinkStore.failPendingLink,
			logger,
		}),
		[INBOX_DLQ_SOURCE_QUEUES.confirmGmailForwarding]: initConfirmGmailForwardingDlqHandler({
			logger,
		}),
		[INBOX_DLQ_SOURCE_QUEUES.ingestGmailImport]: initIngestGmailImportDlqHandler({
			publishEvent,
			logger,
		}),
	},
});
