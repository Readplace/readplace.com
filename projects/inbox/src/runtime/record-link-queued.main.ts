import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { initCanonicalAliasStore, initDynamoDbFindQueueRowKeys } from "@packages/article-store";
import { initDynamoDbIsAccountLive } from "@packages/account-liveness";
import { RECORD_LINK_QUEUED_ENV } from "./record-link-queued.env";
import { initDynamoDbInboxSavedLink, initDynamoDbMarkLinkSavedWhileQueued } from "@packages/inbox-store";
import { initRecordLinkQueuedHandler } from "./domain/inbox/record-link-queued-handler";
import { initFindLinkQueueRowKeys } from "./domain/inbox/find-link-queue-row-keys";
import { initRecordQueuedLink } from "./domain/inbox/record-queued-link";
import { initRecordFailedLink } from "./domain/inbox/record-failed-link";

const env = readEnv(RECORD_LINK_QUEUED_ENV);

const logger = Logger.from(consoleLogger);
const client = createDynamoDocumentClient();
const now = () => new Date();
const inboxSavedLinkStore = initDynamoDbInboxSavedLink({
	client,
	tableName: env.DYNAMODB_INBOX_SAVED_LINKS_TABLE,
	now,
});
const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
	findIdentityRow: initCanonicalAliasStore({ client, tableName: env.DYNAMODB_ARTICLES_TABLE }).findIdentityRow,
	findQueueRowKeys: initDynamoDbFindQueueRowKeys({ client, userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE }),
});
const markLinkSavedWhileQueued = initDynamoDbMarkLinkSavedWhileQueued({
	client,
	savedLinksTableName: env.DYNAMODB_INBOX_SAVED_LINKS_TABLE,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
	now,
});

export const handler = initRecordLinkQueuedHandler({
	recordQueuedLink: initRecordQueuedLink({ findLinkQueueRowKeys, markLinkSavedWhileQueued }),
	recordFailedLink: initRecordFailedLink({
		findLinkQueueRowKeys,
		markLinkSavedWhileQueued,
		isAccountLive: initDynamoDbIsAccountLive({ client, usersTableName: env.DYNAMODB_USERS_TABLE }),
		markLinkSaveFailed: inboxSavedLinkStore.markLinkSaveFailed,
	}),
	retractLinkSaved: inboxSavedLinkStore.retractLinkSaved,
	logger,
});
