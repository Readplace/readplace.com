import type { GmailEmailUpdateFailedLine } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailMapping,
	initDynamoDbGmailMessageUpdate,
} from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { initGmailMessageUpdateHandler } from "./domain/gmail/gmail-message-update-handler";
import { initMarkGmailEmailImported } from "./domain/gmail/mark-gmail-email-imported";
import { initFindMarkImportedSince } from "./domain/gmail/mark-imported-gate";
import { initOpenGmailMailboxForUpdate } from "./providers/gmail-api/gmail-message-update";
import { GMAIL_MESSAGE_UPDATE_ENV } from "./gmail-message-update.env";

const env = readEnv(GMAIL_MESSAGE_UPDATE_ENV);

const client = createDynamoDocumentClient();
const now = () => new Date();
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const updates = initDynamoDbGmailMessageUpdate({ client, tableName: env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE });

export const handler = initGmailMessageUpdateHandler({
	markImported: initMarkGmailEmailImported({
		updates,
		findMarkImportedSince: initFindMarkImportedSince({
			findMapping: initDynamoDbGmailMapping({ client, tableName: env.DYNAMODB_GMAIL_MAPPINGS_TABLE, now }).findMapping,
		}),
		connections: initDynamoDbGmailConnection({ client, tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE, now }),
		openMailbox: initOpenGmailMailboxForUpdate({
			clientId: env.GMAIL_INTEGRATION_CLIENT_ID,
			clientSecret: env.GMAIL_INTEGRATION_CLIENT_SECRET,
			credentials: initDynamoDbGmailCredentials({ client, tableName: env.DYNAMODB_GMAIL_CREDENTIALS_TABLE, now }),
			fetch: globalThis.fetch,
		}),
		now,
	}),
	listPendingByAccount: updates.listPendingByAccount,
	publishEvent,
	metricLog: Logger.fromJSON<GmailEmailUpdateFailedLine>(),
	logger: Logger.from(consoleLogger),
});
