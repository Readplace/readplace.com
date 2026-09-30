import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { INBOX_DLQ_SOURCE_QUEUES } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { initConfirmGmailForwardingDlqHandler } from "./domain/gmail/confirm-gmail-forwarding-dlq-handler";
import { initCrawlEmailLinkPreviewDlqHandler } from "./domain/inbox/crawl-email-link-preview-dlq-handler";
import { initExtractEmailLinksDlqHandler } from "./domain/inbox/extract-email-links-dlq-handler";
import { initIngestGmailImportDlqHandler } from "./domain/inbox/ingest-gmail-import-dlq-handler";

const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const logger = HutchLogger.from(consoleLogger);
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
