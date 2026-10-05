import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailHistoryImport } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import {
	initGmailHistoryImportOutcomeDlqHandler,
	initGmailHistoryImportPageDlqHandler,
} from "./domain/gmail/gmail-history-import-dlq-handler";
import { initRecordGmailDiagnostic } from "./observability/gmail-diagnostics";

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const dependencies = {
	imports: initDynamoDbGmailHistoryImport({ client: createDynamoDocumentClient(), tableName: requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE") }),
	publishEvent,
	now,
	logger,
	recordDiagnostic: initRecordGmailDiagnostic({ logger, now }),
};

export const handler = initDeadLetterRouter({
	routes: {
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.pages]: initGmailHistoryImportPageDlqHandler(dependencies),
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.outcomes]: initGmailHistoryImportOutcomeDlqHandler(dependencies),
	},
});
