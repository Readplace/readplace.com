import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbInboxSavedLink } from "@packages/inbox-store";
import { initRecordLinkQueuedHandler } from "./domain/inbox/record-link-queued-handler";

const inboxSavedLinksTable = requireEnv("DYNAMODB_INBOX_SAVED_LINKS_TABLE");

const logger = HutchLogger.from(consoleLogger);
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
