import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { initExtractEmailLinksDlqHandler } from "./domain/inbox/extract-email-links-dlq-handler";

const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");

const logger = HutchLogger.from(consoleLogger);
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: createDynamoDocumentClient(),
	tableName: inboxEmailLinksTable,
});

export const handler = initExtractEmailLinksDlqHandler({
	markLinksExtractionFailed: inboxEmailLinkStore.markLinksExtractionFailed,
	logger,
});
