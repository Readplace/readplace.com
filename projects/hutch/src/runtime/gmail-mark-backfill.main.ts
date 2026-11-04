import { SQSClient } from "@aws-sdk/client-sqs";
import { ProcessGmailMarkBackfillPageCommand } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	initDynamoDbEmailImportCompletion,
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailMapping,
	initDynamoDbGmailMarkBackfill,
	initDynamoDbGmailMessageUpdate,
	initDynamoDbInboxEmailLink,
} from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { initGmailMarkBackfillHandler } from "./domain/gmail/gmail-mark-backfill";
import { initFindMarkImportedSince } from "./domain/gmail/mark-imported-gate";
import { initOpenGmailMailboxForUpdate } from "./providers/gmail-api/gmail-message-update";
import { GMAIL_MARK_BACKFILL_ENV } from "./gmail-mark-backfill.env";

const env = readEnv(GMAIL_MARK_BACKFILL_ENV);

const client = createDynamoDocumentClient();
const now = () => new Date();
const historyImportsTable = env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE;
const mappings = initDynamoDbGmailMapping({ client, tableName: env.DYNAMODB_GMAIL_MAPPINGS_TABLE, now });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });

export const handler = initGmailMarkBackfillHandler({
	backfills: initDynamoDbGmailMarkBackfill({ client, tableName: historyImportsTable }),
	updates: initDynamoDbGmailMessageUpdate({ client, tableName: historyImportsTable }),
	connections: initDynamoDbGmailConnection({ client, tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE, now }),
	mappings,
	findMarkImportedSince: initFindMarkImportedSince({ findMapping: mappings.findMapping }),
	completions: initDynamoDbEmailImportCompletion({ client, tableName: env.DYNAMODB_INBOX_EMAILS_TABLE }),
	links: initDynamoDbInboxEmailLink({ client, tableName: env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE }),
	openMailbox: initOpenGmailMailboxForUpdate({
		clientId: env.GMAIL_INTEGRATION_CLIENT_ID,
		clientSecret: env.GMAIL_INTEGRATION_CLIENT_SECRET,
		credentials: initDynamoDbGmailCredentials({ client, tableName: env.DYNAMODB_GMAIL_CREDENTIALS_TABLE, now }),
		fetch: globalThis.fetch,
	}),
	dispatchPage: initSqsCommandDispatcher({
		sqsClient: new SQSClient({}),
		queueUrl: env.GMAIL_MARK_BACKFILL_QUEUE_URL,
		command: ProcessGmailMarkBackfillPageCommand,
		delaySeconds: 10,
	}).dispatch,
	publishEvent,
	logger: Logger.from(consoleLogger),
	now,
});
