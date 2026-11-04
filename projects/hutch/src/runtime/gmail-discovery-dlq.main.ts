import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailDiscovery } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initGmailDiscoveryDlqHandler } from "./domain/gmail/gmail-discovery-handler";

const client = createDynamoDocumentClient();
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
export const handler = initGmailDiscoveryDlqHandler({
	discovery: initDynamoDbGmailDiscovery({ client, tableName: requireEnv("DYNAMODB_GMAIL_DISCOVERY_TABLE"), now: () => new Date() }),
	publishEvent,
	logger: Logger.from(consoleLogger),
});
