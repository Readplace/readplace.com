import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailDiscovery } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { initGmailDiscoveryDlqHandler } from "./domain/gmail/gmail-discovery-handler";
import { GMAIL_DISCOVERY_DLQ_ENV } from "./gmail-discovery-dlq.env";

const env = readEnv(GMAIL_DISCOVERY_DLQ_ENV);

const client = createDynamoDocumentClient();
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
export const handler = initGmailDiscoveryDlqHandler({
	discovery: initDynamoDbGmailDiscovery({ client, tableName: env.DYNAMODB_GMAIL_DISCOVERY_TABLE, now: () => new Date() }),
	publishEvent,
	logger: Logger.from(consoleLogger),
});
