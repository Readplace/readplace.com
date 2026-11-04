import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbEmailImportCompletion } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import { initEvaluateGmailImportCompletion } from "./domain/gmail-import-completion/evaluate-gmail-import-completion";
import { initGmailImportCompletionHandler } from "./domain/gmail-import-completion/gmail-import-completion-handler";

const completion = initDynamoDbEmailImportCompletion({
	client: createDynamoDocumentClient(),
	tableName: requireEnv("DYNAMODB_INBOX_EMAILS_TABLE"),
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: requireEnv("EVENT_BUS_NAME"),
});

export const handler = initGmailImportCompletionHandler({
	acknowledgeOutput: completion.acknowledgeOutput,
	evaluate: initEvaluateGmailImportCompletion({ findCompletion: completion.findCompletion, publishEvent }),
	logger: Logger.from(consoleLogger),
});
