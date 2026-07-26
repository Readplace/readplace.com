import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initSubmitLinkDlqHandler } from "./domain/submit-link/submit-link-dlq-handler";

const eventBusName = requireEnv("EVENT_BUS_NAME");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initSubmitLinkDlqHandler({
	publishEvent,
	logger: consoleLogger,
});
