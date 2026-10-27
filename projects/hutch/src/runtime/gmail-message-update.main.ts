import type { GmailEmailUpdateFailedLine } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailMessageUpdate } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initGmailMessageUpdateHandler } from "./domain/gmail/gmail-message-update-handler";
import { initMarkGmailEmailImported } from "./domain/gmail/mark-gmail-email-imported";
import { initOpenGmailMailboxForUpdate } from "./providers/gmail-api/gmail-message-update";

const client = createDynamoDocumentClient();
const now = () => new Date();
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const updates = initDynamoDbGmailMessageUpdate({ client, tableName: requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE") });

export const handler = initGmailMessageUpdateHandler({
	markImported: initMarkGmailEmailImported({
		updates,
		connections: initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now }),
		openMailbox: initOpenGmailMailboxForUpdate({
			clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"),
			clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"),
			credentials: initDynamoDbGmailCredentials({ client, tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"), now }),
			fetch: globalThis.fetch,
		}),
		now,
	}),
	listPendingByAccount: updates.listPendingByAccount,
	publishEvent,
	metricLog: HutchLogger.fromJSON<GmailEmailUpdateFailedLine>(),
	logger: HutchLogger.from(consoleLogger),
});
