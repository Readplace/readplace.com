/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initReaderReadyUsersNotificationFanoutHandler } from "./reader-ready-fanout/reader-ready-fanout-handler";
import { requireEnv } from "@packages/require-env";

/** TTL safety net on queued digest rows: generous enough that an unverified
 * user can verify and still receive a queued article, bounded so abandoned rows
 * are purged. Rows are normally drained on the next 6h digest send. */
const DIGEST_QUEUE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const digestQueueTable = requireEnv("DYNAMODB_DIGEST_QUEUE_TABLE");

const dynamoClient = createDynamoDocumentClient();
const logger = HutchLogger.from(consoleLogger);

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger,
});

const digestQueue = initDynamoDbDigestQueue({
	client: dynamoClient,
	tableName: digestQueueTable,
});

export const handler = initReaderReadyUsersNotificationFanoutHandler({
	findUserArticlesByUrl: articleStore.findUserArticlesByUrl,
	markReaderViewSucceeded: articleStore.markReaderViewSucceeded,
	enqueueDigestItem: digestQueue.enqueueDigestItem,
	digestRetentionMs: DIGEST_QUEUE_RETENTION_MS,
	now: () => new Date(),
	logger,
});
/* c8 ignore stop */
