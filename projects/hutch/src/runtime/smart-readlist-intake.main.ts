import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initSmartReadlistIntakeHandler } from "./domain/readlist/smart-readlist-intake-handler";
import { SMART_READLIST_INTAKE_ENV } from "./smart-readlist-intake.env";

const env = readEnv(SMART_READLIST_INTAKE_ENV);

const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
	client: createDynamoDocumentClient(),
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

export const handler = initSmartReadlistIntakeHandler({
	listReadlistDefinitions,
	publishEvent,
	logger: Logger.from(consoleLogger),
});
