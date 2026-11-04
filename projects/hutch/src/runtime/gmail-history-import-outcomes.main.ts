import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailHistoryImport } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { initRecordGmailHistoryImportOutcomeHandler } from "./domain/gmail/record-gmail-history-import-outcome-handler";
import { initRecordGmailDiagnostic } from "./observability/gmail-diagnostics";
import { GMAIL_HISTORY_IMPORT_OUTCOMES_ENV } from "./gmail-history-import-outcomes.env";

const env = readEnv(GMAIL_HISTORY_IMPORT_OUTCOMES_ENV);

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const now = () => new Date();
const logger = Logger.from(consoleLogger);

export const handler = initRecordGmailHistoryImportOutcomeHandler({
	imports: initDynamoDbGmailHistoryImport({ client: createDynamoDocumentClient(), tableName: env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE }),
	publishEvent,
	now,
	logger,
	recordDiagnostic: initRecordGmailDiagnostic({ logger, now }),
});
