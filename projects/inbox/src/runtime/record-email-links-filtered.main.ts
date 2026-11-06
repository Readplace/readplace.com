import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { RECORD_EMAIL_LINKS_FILTERED_ENV } from "./record-email-links-filtered.env";
import { initRecordEmailLinksFilteredHandler } from "./domain/inbox/record-email-links-filtered-handler";

const env = readEnv(RECORD_EMAIL_LINKS_FILTERED_ENV);

const inboxEmailLinksTable = env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE;

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
