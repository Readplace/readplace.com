import { SQSClient } from "@aws-sdk/client-sqs";
import { ProcessGmailMarkBackfillPageCommand } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	initDynamoDbEmailImportCompletion,
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailMapping,
	initDynamoDbGmailMarkBackfill,
	initDynamoDbGmailMessageUpdate,
	initDynamoDbInboxEmailLink,
} from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initGmailMarkBackfillHandler } from "./domain/gmail/gmail-mark-backfill";
import { initFindMarkImportedSince } from "./domain/gmail/mark-imported-gate";
import { initOpenGmailMailboxForUpdate } from "./providers/gmail-api/gmail-message-update";

const client = createDynamoDocumentClient();
const now = () => new Date();
const historyImportsTable = requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE");
const mappings = initDynamoDbGmailMapping({ client, tableName: requireEnv("DYNAMODB_GMAIL_MAPPINGS_TABLE"), now });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });

export const handler = initGmailMarkBackfillHandler({
	backfills: initDynamoDbGmailMarkBackfill({ client, tableName: historyImportsTable }),
	updates: initDynamoDbGmailMessageUpdate({ client, tableName: historyImportsTable }),
	connections: initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now }),
	mappings,
	findMarkImportedSince: initFindMarkImportedSince({ findMapping: mappings.findMapping }),
	completions: initDynamoDbEmailImportCompletion({ client, tableName: requireEnv("DYNAMODB_INBOX_EMAILS_TABLE") }),
	links: initDynamoDbInboxEmailLink({ client, tableName: requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE") }),
	openMailbox: initOpenGmailMailboxForUpdate({
		clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"),
		clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"),
		credentials: initDynamoDbGmailCredentials({ client, tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"), now }),
		fetch: globalThis.fetch,
	}),
	dispatchPage: initSqsCommandDispatcher({
		sqsClient: new SQSClient({}),
		queueUrl: requireEnv("GMAIL_MARK_BACKFILL_QUEUE_URL"),
		command: ProcessGmailMarkBackfillPageCommand,
		delaySeconds: 10,
	}).dispatch,
	publishEvent,
	logger: HutchLogger.from(consoleLogger),
	now,
});
