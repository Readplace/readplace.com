import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher, initSqsCommandDispatcher } from "@packages/hutch-infra-components/runtime";
import { GmailHistoryImportMessageFetchedEvent, ProcessGmailHistoryImportPageCommand } from "@packages/hutch-infra-components";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailHistoryImport,
	initDynamoDbGmailSender,
	initS3WriteRawEmail,
} from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initGmailHistoryImport } from "./domain/gmail/gmail-history-import";
import { initGmailHistoryImportHandler } from "./domain/gmail/gmail-history-import-handler";
import { initGmailReadonlyAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailHistory } from "./providers/gmail-api/gmail-history";

const client = createDynamoDocumentClient();
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const credentials = initDynamoDbGmailCredentials({ client, tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"), now });
const history = initGmailHistory({
	accessToken: initGmailReadonlyAccessToken({
		clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"),
		clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"),
		credentials,
		fetch: globalThis.fetch,
		now,
		logger,
	}),
	fetch: globalThis.fetch,
});

export const handler = initGmailHistoryImportHandler({
	importer: initGmailHistoryImport({
		history,
		imports: initDynamoDbGmailHistoryImport({ client, tableName: requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE") }),
		connections: initDynamoDbGmailConnection({ client, tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"), now }),
		senders: initDynamoDbGmailSender({ client, tableName: requireEnv("DYNAMODB_GMAIL_SENDERS_TABLE"), now }),
		putRaw: initS3WriteRawEmail({ client: new S3Client({}), bucketName: requireEnv("RAW_EMAIL_BUCKET_NAME") }),
		publishFetched: async (detail) => {
			await publishEvent(GmailHistoryImportMessageFetchedEvent, detail);
		},
		now,
	}),
	dispatchPage: initSqsCommandDispatcher({
		sqsClient: new SQSClient({}),
		queueUrl: requireEnv("GMAIL_HISTORY_IMPORT_QUEUE_URL"),
		command: ProcessGmailHistoryImportPageCommand,
		delaySeconds: 10,
	}).dispatch,
	publishEvent,
	logger,
});
