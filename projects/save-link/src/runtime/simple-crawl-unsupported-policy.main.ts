import { consoleLogger } from "@packages/logger";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { readEnv } from "@packages/require-env";
import { SIMPLE_CRAWL_UNSUPPORTED_POLICY_ENV } from "./simple-crawl-unsupported-policy.env";
import { initSimpleCrawlUnsupportedPolicyHandler } from "./domain/simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-handler";

const env = readEnv(SIMPLE_CRAWL_UNSUPPORTED_POLICY_ENV);

const eventBusName = env.EVENT_BUS_NAME;

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initSimpleCrawlUnsupportedPolicyHandler({
	publishEvent,
	logger: consoleLogger,
});
