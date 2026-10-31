import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES, type GmailEmailUpdateFailedLine } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailHistoryImport, initDynamoDbGmailMarkBackfill, initDynamoDbGmailMessageUpdate } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import {
	initGmailHistoryImportOutcomeDlqHandler,
	initGmailHistoryImportPageDlqHandler,
} from "./domain/gmail/gmail-history-import-dlq-handler";
import { initGmailMarkBackfillDlqHandler } from "./domain/gmail/gmail-mark-backfill";
import { initGmailMessageUpdateDlqHandler } from "./domain/gmail/gmail-message-update-handler";
import { initRecordGmailDiagnostic } from "./observability/gmail-diagnostics";

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const now = () => new Date();
const logger = HutchLogger.from(consoleLogger);
const client = createDynamoDocumentClient();
const tableName = requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE");
const dependencies = {
	imports: initDynamoDbGmailHistoryImport({ client, tableName }),
	publishEvent,
	now,
	logger,
	recordDiagnostic: initRecordGmailDiagnostic({ logger, now }),
};

export const handler = initDeadLetterRouter({
	routes: {
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.pages]: initGmailHistoryImportPageDlqHandler(dependencies),
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.outcomes]: initGmailHistoryImportOutcomeDlqHandler(dependencies),
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.messageUpdates]: initGmailMessageUpdateDlqHandler({
			markFailed: initDynamoDbGmailMessageUpdate({ client, tableName }).markFailed,
			publishEvent,
			metricLog: HutchLogger.fromJSON<GmailEmailUpdateFailedLine>(),
			logger,
			now,
		}),
		[GMAIL_HISTORY_IMPORT_DLQ_SOURCE_QUEUES.markBackfill]: initGmailMarkBackfillDlqHandler({
			failBackfill: initDynamoDbGmailMarkBackfill({ client, tableName }).failBackfill,
			logger,
			now,
		}),
	},
});
