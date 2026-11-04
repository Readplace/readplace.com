import { randomUUID } from "node:crypto";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/infra-components/runtime";
import { DiscoverGmailSendersPageCommand } from "@packages/infra-components";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailDiscovery } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { initDiscoverGmailSenders } from "./domain/gmail/discover-gmail-senders";
import { initGmailDiscoveryHandler } from "./domain/gmail/gmail-discovery-handler";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailMailbox } from "./providers/gmail-api/gmail-mailbox";
import { GMAIL_DISCOVERY_ENV } from "./gmail-discovery.env";

const env = readEnv(GMAIL_DISCOVERY_ENV);

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = Logger.from(consoleLogger);
const sqs = new SQSClient({});
const queueUrl = env.GMAIL_DISCOVERY_QUEUE_URL;
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const credentials = initDynamoDbGmailCredentials({ client, tableName: env.DYNAMODB_GMAIL_CREDENTIALS_TABLE, now });
const discovery = initDynamoDbGmailDiscovery({ client, tableName: env.DYNAMODB_GMAIL_DISCOVERY_TABLE, now });
const connections = initDynamoDbGmailConnection({ client, tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE, now });
const mailbox = initGmailMailbox({
	accessToken: initGmailAccessToken({ clientId: env.GMAIL_INTEGRATION_CLIENT_ID, clientSecret: env.GMAIL_INTEGRATION_CLIENT_SECRET, credentials, fetch: globalThis.fetch, now, logger }),
	fetch: globalThis.fetch,
});

export const handler = initGmailDiscoveryHandler({
	discover: initDiscoverGmailSenders({ mailbox, connections, discovery, newGeneration: randomUUID }),
	dispatchPage: initSqsCommandDispatcher({ sqsClient: sqs, queueUrl, command: DiscoverGmailSendersPageCommand, delaySeconds: 10 }).dispatch,
	publishEvent,
	logger,
});
