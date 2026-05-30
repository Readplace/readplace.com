/* c8 ignore start -- composition root, no logic to test */
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { NotifyReaderViewReadyCommand } from "@packages/hutch-infra-components";
import { initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initReaderReadyFanoutHandler } from "./reader-ready-fanout/reader-ready-fanout-handler";
import { requireEnv } from "./domain/require-env";

/** ~5 min so a present user's final in-reader poll lands before the notify gate
 * runs (viewedAt ≥ succeededAt ⇒ suppressed). Below the 900s SQS maximum. */
const NOTIFY_DELAY_SECONDS = 300;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const notifyQueueUrl = requireEnv("READER_READY_NOTIFY_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const { dispatch: dispatchNotifyReaderViewReady } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: notifyQueueUrl,
	command: NotifyReaderViewReadyCommand,
	delaySeconds: NOTIFY_DELAY_SECONDS,
});

export const handler = initReaderReadyFanoutHandler({
	findUserArticlesByUrl: articleStore.findUserArticlesByUrl,
	markReaderViewSucceeded: articleStore.markReaderViewSucceeded,
	dispatchNotifyReaderViewReady,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
