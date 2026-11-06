import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { RECORD_LINK_QUEUED_ENV } from "./record-link-queued.env";
import { initDynamoDbInboxSavedLink } from "@packages/inbox-store";
import { initRecordLinkQueuedHandler } from "./domain/inbox/record-link-queued-handler";

const env = readEnv(RECORD_LINK_QUEUED_ENV);

const inboxSavedLinksTable = env.DYNAMODB_INBOX_SAVED_LINKS_TABLE;

const logger = Logger.from(consoleLogger);
const inboxSavedLinkStore = initDynamoDbInboxSavedLink({
	client: createDynamoDocumentClient(),
	tableName: inboxSavedLinksTable,
	now: () => new Date(),
});

export const handler = initRecordLinkQueuedHandler({
	markLinkSaved: inboxSavedLinkStore.markLinkSaved,
	markLinkSaveFailed: inboxSavedLinkStore.markLinkSaveFailed,
	retractLinkSaved: inboxSavedLinkStore.retractLinkSaved,
	logger,
});
