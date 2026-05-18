import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { requireEnv } from "../require-env";
import { initSimpleCrawlUnsupportedPolicyHandler } from "./domain/simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-handler";

const eventBusName = requireEnv("EVENT_BUS_NAME");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initSimpleCrawlUnsupportedPolicyHandler({
	publishEvent,
	logger: consoleLogger,
});
