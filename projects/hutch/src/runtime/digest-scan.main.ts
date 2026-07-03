/* c8 ignore start -- composition root, no logic to test */
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { SendUserDigestCommand } from "@packages/hutch-infra-components";
import { initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbDigestQueue } from "./providers/digest-queue/dynamodb-digest-queue";
import { initDigestScanHandler } from "./digest-scan/digest-scan-handler";
import { requireEnv } from "@packages/require-env";

/** Retention is only consulted on enqueue (the fan-out); the scan path never
 * writes. Kept in sync with the fan-out so a single provider construction here
 * has a defined value. */
const DIGEST_QUEUE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const digestQueueTable = requireEnv("DYNAMODB_DIGEST_QUEUE_TABLE");
const sendUserDigestQueueUrl = requireEnv("SEND_USER_DIGEST_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});

const { scanPendingDigestUsers } = initDynamoDbDigestQueue({
	client: dynamoClient,
	tableName: digestQueueTable,
	retentionMs: DIGEST_QUEUE_RETENTION_MS,
});

const { dispatch: dispatchSendUserDigest } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: sendUserDigestQueueUrl,
	command: SendUserDigestCommand,
});

export const handler = initDigestScanHandler({
	scanPendingDigestUsers,
	dispatchSendUserDigest,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
