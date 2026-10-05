import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailHistoryImport } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initRecordGmailHistoryImportOutcomeHandler } from "./domain/gmail/record-gmail-history-import-outcome-handler";
import { initRecordGmailDiagnostic } from "./observability/gmail-diagnostics";

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);

export const handler = initRecordGmailHistoryImportOutcomeHandler({
	imports: initDynamoDbGmailHistoryImport({ client: createDynamoDocumentClient(), tableName: requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE") }),
	publishEvent,
	now,
	logger,
	recordDiagnostic: initRecordGmailDiagnostic({ logger, now }),
});
