import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbInboxEmail, initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { initRecordEmailLinksFilteredHandler } from "./domain/inbox/record-email-links-filtered-handler";

const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");

const logger = HutchLogger.from(consoleLogger);
const dynamoClient = createDynamoDocumentClient();
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});
const inboxEmailStore = initDynamoDbInboxEmail({ client: dynamoClient, tableName: inboxEmailsTable });

export const handler = initRecordEmailLinksFilteredHandler({
	markLinkDropped: inboxEmailLinkStore.markLinkDropped,
	settleReadlistDecision: inboxEmailLinkStore.settleReadlistDecision,
	listLinksByEmail: inboxEmailLinkStore.listLinksByEmail,
	setEmailLinkCounts: inboxEmailStore.setEmailLinkCounts,
	logger,
});
