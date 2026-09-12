import { randomUUID } from "node:crypto";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { DiscoverGmailSendersPageCommand } from "@packages/hutch-infra-components";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailDiscovery } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initDiscoverGmailSenders } from "./domain/gmail/discover-gmail-senders";
import { initGmailDiscoveryHandler } from "./domain/gmail/gmail-discovery-handler";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailMailbox } from "./providers/gmail-api/gmail-mailbox";

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const sqs = new SQSClient({});
const queueUrl = requireEnv("GMAIL_DISCOVERY_QUEUE_URL");
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const credentials = initDynamoDbGmailCredentials({ client, tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"), now });
const discovery = initDynamoDbGmailDiscovery({ client, tableName: requireEnv("DYNAMODB_GMAIL_DISCOVERY_TABLE"), now });
const connections = initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now });
const mailbox = initGmailMailbox({
	accessToken: initGmailAccessToken({ clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"), clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"), credentials, fetch: globalThis.fetch, now }),
	fetch: globalThis.fetch,
});

export const handler = initGmailDiscoveryHandler({
	discover: initDiscoverGmailSenders({ mailbox, connections, discovery, newGeneration: randomUUID }),
	dispatchPage: initSqsCommandDispatcher({ sqsClient: sqs, queueUrl, command: DiscoverGmailSendersPageCommand, delaySeconds: 10 }).dispatch,
	publishEvent,
	logger,
});
