import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initRecordEmailLinksFilteredHandler } from "./domain/inbox/record-email-links-filtered-handler";

const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");

const logger = Logger.from(consoleLogger);
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: createDynamoDocumentClient(),
	tableName: inboxEmailLinksTable,
});

export const handler = initRecordEmailLinksFilteredHandler({
	putReadlistOutcome: inboxEmailLinkStore.putReadlistOutcome,
	listLinksByEmail: inboxEmailLinkStore.listLinksByEmail,
	logger,
});
