/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailConnection } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import type { GmailConnectionsCountLine } from "./observability/events";
import { initCountGmailConnectionsHandler } from "./count-gmail-connections/count-gmail-connections-handler";
import { COUNT_GMAIL_CONNECTIONS_ENV } from "./count-gmail-connections.env";

const env = readEnv(COUNT_GMAIL_CONNECTIONS_ENV);

const client = createDynamoDocumentClient();
const now = () => new Date();

const { countConnected } = initDynamoDbGmailConnection({
	client,
	tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE,
	now,
});

export const handler = initCountGmailConnectionsHandler({
	countConnected,
	metricLog: Logger.fromJSON<GmailConnectionsCountLine>(),
	logger: Logger.from(consoleLogger),
});
/* c8 ignore stop */
